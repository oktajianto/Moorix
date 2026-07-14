use std::collections::HashSet;
use std::time::Duration;

use serde::Deserialize;
use tauri::ipc::Channel;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::sync::mpsc::{unbounded_channel, UnboundedSender};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TelnetConfig {
    host: String,
    port: u16,
}

// Telnet control bytes (RFC 854) and the handful of options we care about.
const IAC: u8 = 255;
const DONT: u8 = 254;
const DO: u8 = 253;
const WONT: u8 = 252;
const WILL: u8 = 251;
const SB: u8 = 250;
const SE: u8 = 240;
const OPT_ECHO: u8 = 1;
const OPT_SGA: u8 = 3;

enum TelnetInput {
    Data(Vec<u8>),
}

/// A Telnet session over TCP. Owning it owns the input side of the IO task;
/// dropping it stops the task and closes the connection.
pub struct TelnetSession {
    input: UnboundedSender<TelnetInput>,
}

impl TelnetSession {
    pub async fn connect(
        cfg: TelnetConfig,
        on_data: Channel<Vec<u8>>,
    ) -> Result<Self, String> {
        let stream = tokio::time::timeout(
            Duration::from_secs(15),
            TcpStream::connect((cfg.host.as_str(), cfg.port)),
        )
        .await
        .map_err(|_| "connection timed out".to_string())?
        .map_err(|e| format!("connect failed: {e}"))?;
        let _ = stream.set_nodelay(true);

        let (mut rd, mut wr) = stream.into_split();
        let (tx, mut rx) = unbounded_channel::<TelnetInput>();

        tauri::async_runtime::spawn(async move {
            let mut buf = [0u8; 4096];
            let mut parser = TelnetParser::default();
            loop {
                tokio::select! {
                    r = rd.read(&mut buf) => match r {
                        Ok(0) | Err(_) => break,
                        Ok(n) => {
                            let (clean, replies) = parser.feed(&buf[..n]);
                            if !replies.is_empty() && wr.write_all(&replies).await.is_err() {
                                break;
                            }
                            if !clean.is_empty() && on_data.send(clean).is_err() {
                                break;
                            }
                        }
                    },
                    msg = rx.recv() => match msg {
                        Some(TelnetInput::Data(d)) => {
                            if wr.write_all(&escape_iac(&d)).await.is_err() {
                                break;
                            }
                            let _ = wr.flush().await;
                        }
                        None => break, // input sender dropped → user closed
                    },
                }
            }
        });

        Ok(Self { input: tx })
    }

    pub fn write(&self, data: &[u8]) -> Result<(), String> {
        self.input
            .send(TelnetInput::Data(data.to_vec()))
            .map_err(|_| "telnet session closed".to_string())
    }
}

/// A literal 0xFF byte in outgoing data must be doubled (IAC IAC).
fn escape_iac(data: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(data.len());
    for &b in data {
        out.push(b);
        if b == IAC {
            out.push(IAC);
        }
    }
    out
}

#[derive(PartialEq)]
enum State {
    Data,
    Iac,
    Negotiate(u8), // saw IAC WILL/WONT/DO/DONT, awaiting the option byte
    Subneg,        // inside IAC SB ... IAC SE
    SubnegIac,
}

/// A minimal, loop-safe Telnet option negotiator. We agree to server-side ECHO
/// and SGA (so it behaves like a normal remote shell) and refuse everything
/// else. `feed` returns the cleaned data plus any bytes to send back.
struct TelnetParser {
    state: State,
    replied: HashSet<(u8, u8)>, // (command, option) already answered, avoids loops
}

impl Default for TelnetParser {
    fn default() -> Self {
        Self {
            state: State::Data,
            replied: HashSet::new(),
        }
    }
}

impl TelnetParser {
    fn feed(&mut self, bytes: &[u8]) -> (Vec<u8>, Vec<u8>) {
        let mut clean = Vec::with_capacity(bytes.len());
        let mut reply = Vec::new();

        for &b in bytes {
            match self.state {
                State::Data => {
                    if b == IAC {
                        self.state = State::Iac;
                    } else {
                        clean.push(b);
                    }
                }
                State::Iac => match b {
                    IAC => {
                        clean.push(IAC); // escaped literal 0xFF
                        self.state = State::Data;
                    }
                    WILL | WONT | DO | DONT => self.state = State::Negotiate(b),
                    SB => self.state = State::Subneg,
                    // Other commands (NOP, GA, …) carry no option — ignore.
                    _ => self.state = State::Data,
                },
                State::Negotiate(cmd) => {
                    self.respond(cmd, b, &mut reply);
                    self.state = State::Data;
                }
                State::Subneg => {
                    if b == IAC {
                        self.state = State::SubnegIac;
                    }
                }
                State::SubnegIac => {
                    // IAC SE ends the subnegotiation; anything else stays inside it.
                    self.state = if b == SE { State::Data } else { State::Subneg };
                }
            }
        }

        (clean, reply)
    }

    fn respond(&mut self, cmd: u8, opt: u8, reply: &mut Vec<u8>) {
        // Only answer a given (cmd, opt) once to avoid negotiation loops.
        if !self.replied.insert((cmd, opt)) {
            return;
        }
        let response = match cmd {
            // Server offers to enable an option on its side.
            WILL => {
                if opt == OPT_ECHO || opt == OPT_SGA {
                    DO
                } else {
                    DONT
                }
            }
            // Server won't / stops an option — acknowledge.
            WONT => DONT,
            // Server asks us to enable an option — we offer none.
            DO => WONT,
            DONT => WONT,
            _ => return,
        };
        reply.extend_from_slice(&[IAC, response, opt]);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plain_data_passes_through() {
        let mut p = TelnetParser::default();
        let (clean, reply) = p.feed(b"hello");
        assert_eq!(clean, b"hello");
        assert!(reply.is_empty());
    }

    #[test]
    fn escaped_iac_becomes_single_byte() {
        let mut p = TelnetParser::default();
        let (clean, reply) = p.feed(&[IAC, IAC, b'A']);
        assert_eq!(clean, vec![IAC, b'A']);
        assert!(reply.is_empty());
    }

    #[test]
    fn agree_to_server_echo_and_sga() {
        let mut p = TelnetParser::default();
        let (clean, reply) = p.feed(&[IAC, WILL, OPT_ECHO, IAC, WILL, OPT_SGA]);
        assert!(clean.is_empty());
        assert_eq!(reply, vec![IAC, DO, OPT_ECHO, IAC, DO, OPT_SGA]);
    }

    #[test]
    fn refuse_other_options() {
        let mut p = TelnetParser::default();
        let (_, reply_will) = p.feed(&[IAC, WILL, 99]);
        assert_eq!(reply_will, vec![IAC, DONT, 99]);
        let (_, reply_do) = p.feed(&[IAC, DO, 24]);
        assert_eq!(reply_do, vec![IAC, WONT, 24]);
    }

    #[test]
    fn subnegotiation_is_stripped() {
        let mut p = TelnetParser::default();
        // IAC SB TTYPE ... IAC SE, then a real byte.
        let (clean, reply) = p.feed(&[IAC, SB, 24, 1, b'x', b'y', IAC, SE, b'Z']);
        assert_eq!(clean, vec![b'Z']);
        assert!(reply.is_empty());
    }

    #[test]
    fn each_negotiation_answered_once() {
        let mut p = TelnetParser::default();
        let (_, first) = p.feed(&[IAC, WILL, OPT_ECHO]);
        assert_eq!(first, vec![IAC, DO, OPT_ECHO]);
        let (_, second) = p.feed(&[IAC, WILL, OPT_ECHO]);
        assert!(second.is_empty(), "repeat negotiation must not loop");
    }

    #[test]
    fn iac_sequence_split_across_reads() {
        let mut p = TelnetParser::default();
        let (c1, r1) = p.feed(&[b'a', IAC]);
        assert_eq!(c1, b"a");
        assert!(r1.is_empty());
        let (c2, r2) = p.feed(&[WILL, OPT_SGA, b'b']);
        assert_eq!(c2, b"b");
        assert_eq!(r2, vec![IAC, DO, OPT_SGA]);
    }

    #[test]
    fn escape_iac_doubles_ff() {
        assert_eq!(escape_iac(&[0xFF, b'A', 0xFF]), vec![0xFF, 0xFF, b'A', 0xFF, 0xFF]);
        assert_eq!(escape_iac(b"abc"), b"abc");
    }
}
