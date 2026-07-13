use std::borrow::Cow;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use russh::client::{self, AuthResult, Handler};
use russh::keys::ssh_key::{HashAlg, PublicKey};
use russh::keys::{load_secret_key, Algorithm, PrivateKeyWithHashAlg};
use russh::{cipher, compression, kex, mac, ChannelMsg, Disconnect, Preferred};
use serde::Deserialize;
use tauri::ipc::Channel;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::mpsc::{unbounded_channel, UnboundedSender};

use crate::state::AppState;

/// Connection parameters sent from the frontend.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshConfig {
    host: String,
    port: u16,
    username: String,
    auth: SshAuth,
    #[serde(default)]
    keep_alive_interval: Option<u64>,
    #[serde(default)]
    keep_alive_max: Option<usize>,
    #[serde(default)]
    ready_timeout: Option<u64>,
    #[serde(default)]
    ciphers: Option<CipherPrefs>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CipherPrefs {
    ciphers: Vec<String>,
    kex: Vec<String>,
    hmac: Vec<String>,
    host_key: Vec<String>,
    compression: Vec<String>,
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
        app: AppHandle,
        cfg: SshConfig,
        cols: u16,
        rows: u16,
        on_data: Channel<Vec<u8>>,
    ) -> Result<Self, String> {
        let handler = ClientHandler {
            app,
            host: cfg.host.clone(),
            port: cfg.port,
        };

        let mut config = client::Config::default();
        if let Some(ms) = cfg.keep_alive_interval {
            if ms > 0 {
                config.keepalive_interval = Some(Duration::from_millis(ms));
            }
        }
        if let Some(n) = cfg.keep_alive_max {
            config.keepalive_max = n;
        }
        if let Some(c) = &cfg.ciphers {
            let mut pref = Preferred::DEFAULT.clone();
            let ciphers = parse_names::<cipher::Name>(&c.ciphers);
            if !ciphers.is_empty() {
                pref.cipher = Cow::Owned(ciphers);
            }
            let kexs = parse_names::<kex::Name>(&c.kex);
            if !kexs.is_empty() {
                pref.kex = Cow::Owned(kexs);
            }
            let macs = parse_names::<mac::Name>(&c.hmac);
            if !macs.is_empty() {
                pref.mac = Cow::Owned(macs);
            }
            let comps = parse_names::<compression::Name>(&c.compression);
            if !comps.is_empty() {
                pref.compression = Cow::Owned(comps);
            }
            let keys: Vec<Algorithm> =
                c.host_key.iter().filter_map(|s| s.parse().ok()).collect();
            if !keys.is_empty() {
                pref.key = Cow::Owned(keys);
            }
            config.preferred = pref;
        }
        let config = Arc::new(config);

        let connect_fut = client::connect(config, (cfg.host.clone(), cfg.port), handler);
        let mut handle = match cfg.ready_timeout {
            Some(ms) if ms > 0 => tokio::time::timeout(Duration::from_millis(ms), connect_fut)
                .await
                .map_err(|_| "connection timed out".to_string())?
                .map_err(|e| format!("connect failed: {e}"))?,
            _ => connect_fut
                .await
                .map_err(|e| format!("connect failed: {e}"))?,
        };

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

/// Client handler that verifies the server host key (TOFU):
/// - known & matching  → accept
/// - known & different → reject (possible MITM), emit `host-key-mismatch`
/// - unknown           → prompt the frontend (`host-key-prompt`) and wait
struct ClientHandler {
    app: AppHandle,
    host: String,
    port: u16,
}

impl Handler for ClientHandler {
    type Error = russh::Error;

    async fn check_server_key(&mut self, key: &PublicKey) -> Result<bool, Self::Error> {
        let fingerprint = key.fingerprint(HashAlg::Sha256).to_string();
        let host_key = format!("{}:{}", self.host, self.port);
        let mut known = load_known_hosts(&self.app);

        match known.get(&host_key) {
            Some(fp) if *fp == fingerprint => return Ok(true),
            Some(_) => {
                let _ = self.app.emit(
                    "host-key-mismatch",
                    serde_json::json!({ "host": host_key, "fingerprint": fingerprint }),
                );
                return Ok(false);
            }
            None => {}
        }

        // Unknown host — ask the user.
        let (id, rx) = self.app.state::<AppState>().register_host_key_prompt();
        let _ = self.app.emit(
            "host-key-prompt",
            serde_json::json!({ "id": id, "host": host_key, "fingerprint": fingerprint }),
        );

        match rx.await {
            Ok(true) => {
                known.insert(host_key, fingerprint);
                save_known_hosts(&self.app, &known);
                Ok(true)
            }
            _ => Ok(false),
        }
    }
}

fn known_hosts_path(app: &AppHandle) -> Option<PathBuf> {
    let dir = app.path().app_config_dir().ok()?;
    let _ = std::fs::create_dir_all(&dir);
    Some(dir.join("known_hosts.json"))
}

fn load_known_hosts(app: &AppHandle) -> HashMap<String, String> {
    known_hosts_path(app)
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_known_hosts(app: &AppHandle, map: &HashMap<String, String>) {
    if let (Some(path), Ok(json)) = (known_hosts_path(app), serde_json::to_string_pretty(map)) {
        let _ = std::fs::write(path, json);
    }
}

/// Parse algorithm-name strings into russh `Name` types, skipping unknown ones.
fn parse_names<T>(strs: &[String]) -> Vec<T>
where
    T: for<'a> TryFrom<&'a str>,
{
    strs.iter()
        .filter_map(|s| T::try_from(s.as_str()).ok())
        .collect()
}
