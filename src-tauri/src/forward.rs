//! SSH port forwarding (client side): Local (-L) and Dynamic (-D / SOCKS5).
//! Both work by opening `direct-tcpip` channels on the shared SSH handle, so no
//! server-side channel handling is needed. Remote (-R) forwarding is a separate
//! follow-up (it needs the client Handler to accept `forwarded-tcpip` channels).

use std::sync::Arc;

use russh::client::{Handle, Handler};
use tauri::{AppHandle, Emitter};
use tokio::io::{copy_bidirectional, AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::Mutex;

/// Notify the frontend that a forward listener failed to bind its local port,
/// so it can surface a toast instead of the error only reaching the log.
fn emit_bind_error(app: &AppHandle, kind: &str, bind_host: &str, bind_port: u16, err: &str) {
    eprintln!("[moorix] {kind} forward bind {bind_host}:{bind_port} failed: {err}");
    let _ = app.emit(
        "forward-error",
        serde_json::json!({
            "kind": kind,
            "bind": format!("{bind_host}:{bind_port}"),
            "message": err,
        }),
    );
}

/// The SSH connection handle, shared between the shell task and every forward.
/// `Handle` isn't `Sync` (it owns a receiver), so it lives behind a mutex; the
/// lock is only held for the brief `channel_open_direct_tcpip` call.
pub type SharedHandle<H> = Arc<Mutex<Handle<H>>>;

/// Local forward (-L): listen on `bind_host:bind_port` and tunnel each incoming
/// connection to `dest_host:dest_port` as seen from the SSH server.
pub async fn run_local<H: Handler + Send + 'static>(
    app: AppHandle,
    handle: SharedHandle<H>,
    bind_host: String,
    bind_port: u16,
    dest_host: String,
    dest_port: u16,
) {
    let listener = match TcpListener::bind((bind_host.as_str(), bind_port)).await {
        Ok(l) => l,
        Err(e) => {
            emit_bind_error(&app, "local", &bind_host, bind_port, &e.to_string());
            return;
        }
    };
    loop {
        let (socket, peer) = match listener.accept().await {
            Ok(x) => x,
            Err(_) => break,
        };
        let handle = handle.clone();
        let dest_host = dest_host.clone();
        tokio::spawn(async move {
            let channel = {
                let h = handle.lock().await;
                h.channel_open_direct_tcpip(
                    dest_host,
                    dest_port as u32,
                    peer.ip().to_string(),
                    peer.port() as u32,
                )
                .await
            };
            if let Ok(channel) = channel {
                let mut socket = socket;
                let mut stream = channel.into_stream();
                let _ = copy_bidirectional(&mut socket, &mut stream).await;
            }
        });
    }
}

/// Dynamic forward (-D): a SOCKS5 proxy on `bind_host:bind_port`. Each SOCKS
/// CONNECT is tunnelled through a `direct-tcpip` channel to its destination.
pub async fn run_dynamic<H: Handler + Send + 'static>(
    app: AppHandle,
    handle: SharedHandle<H>,
    bind_host: String,
    bind_port: u16,
) {
    let listener = match TcpListener::bind((bind_host.as_str(), bind_port)).await {
        Ok(l) => l,
        Err(e) => {
            emit_bind_error(&app, "dynamic", &bind_host, bind_port, &e.to_string());
            return;
        }
    };
    loop {
        let (socket, _peer) = match listener.accept().await {
            Ok(x) => x,
            Err(_) => break,
        };
        let handle = handle.clone();
        tokio::spawn(async move {
            let _ = handle_socks(handle, socket).await;
        });
    }
}

/// Minimal SOCKS5 (no auth, CONNECT only) handshake, then bridge to an SSH
/// `direct-tcpip` channel.
async fn handle_socks<H: Handler + Send + 'static>(
    handle: SharedHandle<H>,
    mut socket: TcpStream,
) -> std::io::Result<()> {
    // Greeting: VER, NMETHODS, METHODS...
    let mut head = [0u8; 2];
    socket.read_exact(&mut head).await?;
    if head[0] != 0x05 {
        return Ok(()); // not SOCKS5
    }
    let mut methods = vec![0u8; head[1] as usize];
    socket.read_exact(&mut methods).await?;
    // Reply: choose "no authentication".
    socket.write_all(&[0x05, 0x00]).await?;

    // Request: VER, CMD, RSV, ATYP.
    let mut req = [0u8; 4];
    socket.read_exact(&mut req).await?;
    if req[1] != 0x01 {
        // Only CONNECT is supported.
        socket.write_all(&reply(0x07)).await?;
        return Ok(());
    }
    let atyp = req[3];
    let addr = match atyp {
        0x01 => {
            let mut a = [0u8; 4];
            socket.read_exact(&mut a).await?;
            a.to_vec()
        }
        0x03 => {
            let mut len = [0u8; 1];
            socket.read_exact(&mut len).await?;
            let mut d = vec![0u8; len[0] as usize];
            socket.read_exact(&mut d).await?;
            d
        }
        0x04 => {
            let mut a = [0u8; 16];
            socket.read_exact(&mut a).await?;
            a.to_vec()
        }
        _ => {
            socket.write_all(&reply(0x08)).await?; // address type not supported
            return Ok(());
        }
    };
    let mut port = [0u8; 2];
    socket.read_exact(&mut port).await?;
    let port = u16::from_be_bytes(port);

    let host = match addr_to_host(atyp, &addr) {
        Some(h) => h,
        None => {
            socket.write_all(&reply(0x08)).await?;
            return Ok(());
        }
    };

    let channel = {
        let h = handle.lock().await;
        h.channel_open_direct_tcpip(host, port as u32, "127.0.0.1".to_string(), 0)
            .await
    };
    match channel {
        Ok(channel) => {
            socket.write_all(&reply(0x00)).await?; // succeeded
            let mut stream = channel.into_stream();
            let _ = copy_bidirectional(&mut socket, &mut stream).await;
        }
        Err(_) => {
            socket.write_all(&reply(0x01)).await?; // general failure
        }
    }
    Ok(())
}

/// A SOCKS5 reply with the given status and a zero BND.ADDR/BND.PORT.
fn reply(status: u8) -> [u8; 10] {
    [0x05, status, 0x00, 0x01, 0, 0, 0, 0, 0, 0]
}

/// Turn a SOCKS address (by ATYP) into a host string for `direct-tcpip`.
fn addr_to_host(atyp: u8, addr: &[u8]) -> Option<String> {
    match atyp {
        0x01 if addr.len() == 4 => {
            Some(format!("{}.{}.{}.{}", addr[0], addr[1], addr[2], addr[3]))
        }
        0x03 => String::from_utf8(addr.to_vec()).ok(),
        0x04 if addr.len() == 16 => {
            let mut segs = Vec::with_capacity(8);
            for pair in addr.chunks(2) {
                segs.push(format!("{:x}", u16::from_be_bytes([pair[0], pair[1]])));
            }
            Some(segs.join(":"))
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::addr_to_host;

    #[test]
    fn ipv4_addr() {
        assert_eq!(addr_to_host(0x01, &[192, 168, 1, 5]).as_deref(), Some("192.168.1.5"));
    }

    #[test]
    fn domain_addr() {
        assert_eq!(addr_to_host(0x03, b"example.com").as_deref(), Some("example.com"));
    }

    #[test]
    fn ipv6_addr() {
        let addr = [0x20, 0x01, 0x0d, 0xb8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1];
        assert_eq!(addr_to_host(0x04, &addr).as_deref(), Some("2001:db8:0:0:0:0:0:1"));
    }

    #[test]
    fn wrong_length_rejected() {
        assert_eq!(addr_to_host(0x01, &[1, 2, 3]), None);
        assert_eq!(addr_to_host(0x04, &[1, 2, 3]), None);
    }
}
