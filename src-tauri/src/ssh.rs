use std::sync::Arc;

use russh::client::{self, AuthResult, Handler};
use russh::keys::{load_secret_key, PrivateKeyWithHashAlg};
use russh::{ChannelMsg, Disconnect};
use serde::Deserialize;
use tauri::ipc::Channel;
use tokio::sync::mpsc::{unbounded_channel, UnboundedSender};

/// Connection parameters sent from the frontend.
#[derive(Deserialize)]
pub struct SshConfig {
    host: String,
    port: u16,
    username: String,
    auth: SshAuth,
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum SshAuth {
    Password { password: String },
    Key { path: String, passphrase: Option<String> },
}

/// Messages the IO task consumes: user input and terminal resizes.
enum SshInput {
    Data(Vec<u8>),
    Resize { cols: u16, rows: u16 },
}

/// A live SSH session. Owning it means owning the input side of the IO task;
/// dropping it (or removing it from the registry) tears the session down.
pub struct SshSession {
    input: UnboundedSender<SshInput>,
}

impl SshSession {
    pub async fn connect(
        cfg: SshConfig,
        cols: u16,
        rows: u16,
        on_data: Channel<Vec<u8>>,
    ) -> Result<Self, String> {
        let config = Arc::new(client::Config::default());
        let mut handle = client::connect(config, (cfg.host.clone(), cfg.port), ClientHandler)
            .await
            .map_err(|e| format!("connect failed: {e}"))?;

        let auth = match &cfg.auth {
            SshAuth::Password { password } => handle
                .authenticate_password(cfg.username.clone(), password.clone())
                .await
                .map_err(|e| format!("auth error: {e}"))?,
            SshAuth::Key { path, passphrase } => {
                let key = load_secret_key(path, passphrase.as_deref())
                    .map_err(|e| format!("load key failed: {e}"))?;
                handle
                    .authenticate_publickey(
                        cfg.username.clone(),
                        PrivateKeyWithHashAlg::new(Arc::new(key), None),
                    )
                    .await
                    .map_err(|e| format!("auth error: {e}"))?
            }
        };

        if !matches!(auth, AuthResult::Success) {
            return Err("authentication failed".to_string());
        }

        let mut channel = handle
            .channel_open_session()
            .await
            .map_err(|e| e.to_string())?;
        channel
            .request_pty(false, "xterm-256color", cols as u32, rows as u32, 0, 0, &[])
            .await
            .map_err(|e| e.to_string())?;
        channel
            .request_shell(true)
            .await
            .map_err(|e| e.to_string())?;

        let (tx, mut rx) = unbounded_channel::<SshInput>();

        tauri::async_runtime::spawn(async move {
            // Keep the connection handle alive for as long as the task runs.
            let handle = handle;
            loop {
                tokio::select! {
                    msg = channel.wait() => match msg {
                        Some(ChannelMsg::Data { data }) => {
                            if on_data.send(data.to_vec()).is_err() {
                                break;
                            }
                        }
                        Some(ChannelMsg::ExtendedData { data, .. }) => {
                            if on_data.send(data.to_vec()).is_err() {
                                break;
                            }
                        }
                        Some(ChannelMsg::Eof) | Some(ChannelMsg::Close) | None => break,
                        _ => {}
                    },
                    input = rx.recv() => match input {
                        Some(SshInput::Data(d)) => {
                            let _ = channel.data(&d[..]).await;
                        }
                        Some(SshInput::Resize { cols, rows }) => {
                            let _ = channel.window_change(cols as u32, rows as u32, 0, 0).await;
                        }
                        None => break,
                    },
                }
            }

            let _ = handle
                .disconnect(Disconnect::ByApplication, "", "en")
                .await;
        });

        Ok(Self { input: tx })
    }

    pub fn write(&self, data: &[u8]) -> Result<(), String> {
        self.input
            .send(SshInput::Data(data.to_vec()))
            .map_err(|_| "ssh session closed".to_string())
    }

    pub fn resize(&self, cols: u16, rows: u16) -> Result<(), String> {
        self.input
            .send(SshInput::Resize { cols, rows })
            .map_err(|_| "ssh session closed".to_string())
    }
}

/// Client handler. Currently accepts any server key.
///
/// TODO (security): verify the host key against a known_hosts store and prompt
/// the user on first connect — accepting all keys leaves the session open to
/// man-in-the-middle attacks.
struct ClientHandler;

impl Handler for ClientHandler {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        _server_public_key: &russh::keys::ssh_key::PublicKey,
    ) -> Result<bool, Self::Error> {
        Ok(true)
    }
}
