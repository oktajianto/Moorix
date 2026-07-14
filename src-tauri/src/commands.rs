use tauri::ipc::Channel;
use tauri::{AppHandle, State};

use crate::ssh::{SshConfig, SshSession};
use crate::state::{AppState, Session};
use crate::telnet::{TelnetConfig, TelnetSession};

/// Open a new local shell session. `on_data` is a channel the frontend passes
/// in; the backend streams raw PTY output bytes back through it. Desktop only —
/// mobile has no local shell.
#[tauri::command]
pub fn session_open(
    state: State<AppState>,
    on_data: Channel<Vec<u8>>,
    cols: u16,
    rows: u16,
    shell: Option<String>,
) -> Result<String, String> {
    #[cfg(desktop)]
    {
        let session = crate::pty::PtySession::spawn(cols, rows, shell, on_data)?;
        let id = state.next_id();
        state.insert(id.clone(), Session::Pty(session));
        Ok(id)
    }
    #[cfg(mobile)]
    {
        let _ = (state, on_data, cols, rows, shell);
        Err("local shell is not available on mobile".into())
    }
}

/// Open a new SSH session and start an interactive shell on the remote host.
#[tauri::command]
pub async fn ssh_open(
    app: AppHandle,
    state: State<'_, AppState>,
    on_data: Channel<Vec<u8>>,
    config: SshConfig,
    cols: u16,
    rows: u16,
) -> Result<String, String> {
    // Assign the id up front so the session's IO task can name itself in the
    // `session-ended` event it emits if the connection drops (auto-reconnect).
    let id = state.next_id();
    let session = SshSession::connect(app, id.clone(), config, cols, rows, on_data).await?;
    state.insert(id.clone(), Session::Ssh(session));
    Ok(id)
}

/// Open a local serial-port session (desktop only).
#[tauri::command]
pub fn serial_open(
    state: State<AppState>,
    on_data: Channel<Vec<u8>>,
    path: String,
    baud: u32,
) -> Result<String, String> {
    #[cfg(desktop)]
    {
        let session = crate::serial::SerialSession::open(path, baud, on_data)?;
        let id = state.next_id();
        state.insert(id.clone(), Session::Serial(session));
        Ok(id)
    }
    #[cfg(mobile)]
    {
        let _ = (state, on_data, path, baud);
        Err("serial ports are not available on mobile".into())
    }
}

/// List the serial ports available on this machine (desktop only).
#[tauri::command]
pub fn serial_ports() -> Vec<String> {
    #[cfg(desktop)]
    {
        crate::serial::available_ports()
    }
    #[cfg(mobile)]
    {
        Vec::new()
    }
}

/// Open a new Telnet session over TCP.
#[tauri::command]
pub async fn telnet_open(
    state: State<'_, AppState>,
    on_data: Channel<Vec<u8>>,
    config: TelnetConfig,
) -> Result<String, String> {
    let session = TelnetSession::connect(config, on_data).await?;
    let id = state.next_id();
    state.insert(id.clone(), Session::Telnet(session));
    Ok(id)
}

/// Frontend's answer to a `host-key-prompt` event.
#[tauri::command]
pub fn host_key_decision(state: State<AppState>, id: u64, accept: bool) {
    state.resolve_host_key(id, accept);
}

#[tauri::command]
pub fn session_write(state: State<AppState>, id: String, data: Vec<u8>) -> Result<(), String> {
    state.write(&id, &data)
}

#[tauri::command]
pub fn session_resize(
    state: State<AppState>,
    id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    state.resize(&id, cols, rows)
}

#[tauri::command]
pub fn session_close(state: State<AppState>, id: String) -> Result<(), String> {
    state.close(&id);
    Ok(())
}
