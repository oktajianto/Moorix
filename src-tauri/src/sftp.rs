//! SFTP file browser. Each SFTP session opens an `sftp` subsystem channel on an
//! already-authenticated SSH connection (reused via `AppState::ssh_handle`), so
//! there's no extra login. Transfers and remote file operations are added in
//! later stages; this module covers open/list/close.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use russh_sftp::client::SftpSession;
use serde::Serialize;
use tauri::ipc::Channel;
use tauri::State;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

use crate::state::AppState;

#[derive(Serialize)]
pub struct SftpOpened {
    pub id: String,
    pub home: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteEntry {
    pub name: String,
    pub is_dir: bool,
    pub size: u64,
    /// Unix mtime (seconds), 0 if unknown.
    pub mtime: i64,
}

/// Open an SFTP session over the SSH connection behind `session_id`.
#[tauri::command]
pub async fn sftp_open(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<SftpOpened, String> {
    let handle = state
        .ssh_handle(&session_id)
        .ok_or_else(|| "not an SSH session".to_string())?;

    let channel = handle
        .lock()
        .await
        .channel_open_session()
        .await
        .map_err(|e| format!("open channel: {e}"))?;
    channel
        .request_subsystem(true, "sftp")
        .await
        .map_err(|e| format!("request sftp subsystem: {e}"))?;

    let sftp = SftpSession::new(channel.into_stream())
        .await
        .map_err(|e| format!("sftp init: {e}"))?;

    // Resolve the default (home) directory to start browsing from.
    let home = sftp
        .canonicalize(".")
        .await
        .unwrap_or_else(|_| ".".to_string());

    let id = state.next_id();
    state.insert_sftp(id.clone(), Arc::new(sftp));
    Ok(SftpOpened { id, home })
}

/// List a remote directory.
#[tauri::command]
pub async fn sftp_list(
    state: State<'_, AppState>,
    sftp_id: String,
    path: String,
) -> Result<Vec<RemoteEntry>, String> {
    let sftp = state
        .sftp(&sftp_id)
        .ok_or_else(|| "sftp session not found".to_string())?;

    let entries = sftp.read_dir(path).await.map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for entry in entries {
        let md = entry.metadata();
        out.push(RemoteEntry {
            name: entry.file_name(),
            is_dir: md.is_dir(),
            size: md.size.unwrap_or(0),
            mtime: md.mtime.map(|t| t as i64).unwrap_or(0),
        });
    }
    Ok(out)
}

/// Resolve a path to its absolute form (used for ".." navigation / breadcrumbs).
#[tauri::command]
pub async fn sftp_realpath(
    state: State<'_, AppState>,
    sftp_id: String,
    path: String,
) -> Result<String, String> {
    let sftp = state
        .sftp(&sftp_id)
        .ok_or_else(|| "sftp session not found".to_string())?;
    sftp.canonicalize(path).await.map_err(|e| e.to_string())
}

/// Close an SFTP session (its channel drops with it).
#[tauri::command]
pub async fn sftp_close(state: State<'_, AppState>, sftp_id: String) -> Result<(), String> {
    state.remove_sftp(&sftp_id);
    Ok(())
}

/* ------------------------------------------------------------------------- */
/* Remote file operations: mkdir / rename / remove (recursive).              */
/* ------------------------------------------------------------------------- */

#[tauri::command]
pub async fn sftp_mkdir(
    state: State<'_, AppState>,
    sftp_id: String,
    path: String,
) -> Result<(), String> {
    let sftp = state
        .sftp(&sftp_id)
        .ok_or_else(|| "sftp session not found".to_string())?;
    sftp.create_dir(path).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn sftp_rename(
    state: State<'_, AppState>,
    sftp_id: String,
    from: String,
    to: String,
) -> Result<(), String> {
    let sftp = state
        .sftp(&sftp_id)
        .ok_or_else(|| "sftp session not found".to_string())?;
    sftp.rename(from, to).await.map_err(|e| e.to_string())
}

/// Remove a remote file, or a directory and everything under it.
#[tauri::command]
pub async fn sftp_remove(
    state: State<'_, AppState>,
    sftp_id: String,
    path: String,
) -> Result<(), String> {
    let sftp = state
        .sftp(&sftp_id)
        .ok_or_else(|| "sftp session not found".to_string())?;

    let meta = sftp.metadata(path.clone()).await.map_err(|e| e.to_string())?;
    if !meta.is_dir() {
        return sftp.remove_file(path).await.map_err(|e| e.to_string());
    }

    // Pre-order DFS collects dirs parent-first; files are removed as found.
    // Dirs are then removed deepest-first (reverse) so each is empty.
    let mut stack = vec![path.clone()];
    let mut dirs = Vec::new();
    while let Some(d) = stack.pop() {
        dirs.push(d.clone());
        for entry in sftp.read_dir(d.clone()).await.map_err(|e| e.to_string())? {
            let child = join_path(&d, &entry.file_name());
            if entry.metadata().is_dir() {
                stack.push(child);
            } else {
                sftp.remove_file(child).await.map_err(|e| e.to_string())?;
            }
        }
    }
    for d in dirs.iter().rev() {
        sftp.remove_dir(d.clone()).await.map_err(|e| e.to_string())?;
    }
    Ok(())
}

/* ------------------------------------------------------------------------- */
/* Transfers (upload / download), recursive, with progress + cancellation.   */
/* ------------------------------------------------------------------------- */

#[derive(Serialize, Clone)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum TransferEvent {
    Started { total: u64, files: u64 },
    /// Emitted when a new file within the transfer begins (1-based `index`).
    File { index: u64, count: u64, name: String },
    Progress { transferred: u64, total: u64, file: String },
    Done,
    Cancelled,
    Error { message: String },
}

/// Throttled progress emitter (avoids flooding the channel on big files).
struct Prog {
    transferred: u64,
    total: u64,
    last: u64,
}

impl Prog {
    fn bump(&mut self, n: u64, file: &str, ch: &Channel<TransferEvent>) {
        self.transferred += n;
        if self.transferred - self.last >= 256 * 1024 {
            self.last = self.transferred;
            let _ = ch.send(TransferEvent::Progress {
                transferred: self.transferred,
                total: self.total,
                file: file.to_string(),
            });
        }
    }
}

fn basename(p: &str) -> String {
    p.trim_end_matches('/')
        .rsplit('/')
        .next()
        .unwrap_or(p)
        .to_string()
}

fn join_path(dir: &str, name: &str) -> String {
    let d = dir.trim_end_matches('/');
    if d.is_empty() {
        format!("/{name}")
    } else {
        format!("{d}/{name}")
    }
}

/// Upload a local file or directory (recursive) into the remote directory.
#[tauri::command]
pub async fn sftp_upload(
    state: State<'_, AppState>,
    sftp_id: String,
    local_path: String,
    remote_dir: String,
    transfer_id: String,
    on_progress: Channel<TransferEvent>,
) -> Result<(), String> {
    let sftp = state
        .sftp(&sftp_id)
        .ok_or_else(|| "sftp session not found".to_string())?;
    let cancel = state.register_cancel(transfer_id.clone());
    let result = do_upload(&sftp, &local_path, &remote_dir, &cancel, &on_progress).await;
    state.clear_cancel(&transfer_id);
    finish(result, &on_progress)
}

/// Download a remote file or directory (recursive) into the local directory.
#[tauri::command]
pub async fn sftp_download(
    state: State<'_, AppState>,
    sftp_id: String,
    remote_path: String,
    local_dir: String,
    transfer_id: String,
    on_progress: Channel<TransferEvent>,
) -> Result<(), String> {
    let sftp = state
        .sftp(&sftp_id)
        .ok_or_else(|| "sftp session not found".to_string())?;
    let cancel = state.register_cancel(transfer_id.clone());
    let result = do_download(&sftp, &remote_path, &local_dir, &cancel, &on_progress).await;
    state.clear_cancel(&transfer_id);
    finish(result, &on_progress)
}

/// Cancel an in-flight transfer.
#[tauri::command]
pub async fn sftp_cancel(state: State<'_, AppState>, transfer_id: String) -> Result<(), String> {
    state.signal_cancel(&transfer_id);
    Ok(())
}

fn finish(result: Result<bool, String>, ch: &Channel<TransferEvent>) -> Result<(), String> {
    match result {
        Ok(true) => {
            let _ = ch.send(TransferEvent::Done);
            Ok(())
        }
        Ok(false) => {
            let _ = ch.send(TransferEvent::Cancelled);
            Ok(())
        }
        Err(e) => {
            let _ = ch.send(TransferEvent::Error { message: e.clone() });
            Err(e)
        }
    }
}

async fn do_upload(
    sftp: &SftpSession,
    local_path: &str,
    remote_dir: &str,
    cancel: &AtomicBool,
    ch: &Channel<TransferEvent>,
) -> Result<bool, String> {
    let target_root = join_path(remote_dir, &basename(local_path));
    let meta = std::fs::metadata(local_path).map_err(|e| e.to_string())?;

    let mut dirs: Vec<String> = Vec::new();
    let mut files: Vec<(String, String, u64)> = Vec::new(); // (local, remote, size)

    if meta.is_dir() {
        // DFS; a dir is pushed to `dirs` before its children, giving a
        // parent-first ordering that `create_dir` needs.
        let mut stack = vec![(local_path.to_string(), target_root.clone())];
        while let Some((l, r)) = stack.pop() {
            let m = std::fs::metadata(&l).map_err(|e| e.to_string())?;
            if m.is_dir() {
                dirs.push(r.clone());
                for entry in std::fs::read_dir(&l).map_err(|e| e.to_string())? {
                    let entry = entry.map_err(|e| e.to_string())?;
                    let name = entry.file_name().to_string_lossy().into_owned();
                    stack.push((join_path(&l, &name), join_path(&r, &name)));
                }
            } else {
                files.push((l, r, m.len()));
            }
        }
    } else {
        files.push((local_path.to_string(), target_root.clone(), meta.len()));
    }

    let total: u64 = files.iter().map(|f| f.2).sum();
    let _ = ch.send(TransferEvent::Started {
        total,
        files: files.len() as u64,
    });

    for d in &dirs {
        let _ = sftp.create_dir(d.clone()).await; // ignore "already exists"
    }

    let count = files.len() as u64;
    let mut prog = Prog { transferred: 0, total, last: 0 };
    let mut buf = vec![0u8; 32 * 1024];
    for (i, (l, r, _)) in files.iter().enumerate() {
        if cancel.load(Ordering::Relaxed) {
            return Ok(false);
        }
        let name = basename(r);
        let _ = ch.send(TransferEvent::File {
            index: i as u64 + 1,
            count,
            name: name.clone(),
        });
        let mut src = tokio::fs::File::open(l).await.map_err(|e| e.to_string())?;
        let mut dst = sftp.create(r.clone()).await.map_err(|e| e.to_string())?;
        loop {
            if cancel.load(Ordering::Relaxed) {
                return Ok(false);
            }
            let n = src.read(&mut buf).await.map_err(|e| e.to_string())?;
            if n == 0 {
                break;
            }
            dst.write_all(&buf[..n]).await.map_err(|e| e.to_string())?;
            prog.bump(n as u64, &name, ch);
        }
        dst.flush().await.ok();
        dst.shutdown().await.ok();
    }
    Ok(true)
}

async fn do_download(
    sftp: &SftpSession,
    remote_path: &str,
    local_dir: &str,
    cancel: &AtomicBool,
    ch: &Channel<TransferEvent>,
) -> Result<bool, String> {
    let target_root = join_path(local_dir, &basename(remote_path));
    let meta = sftp
        .metadata(remote_path.to_string())
        .await
        .map_err(|e| e.to_string())?;

    let mut files: Vec<(String, String, u64)> = Vec::new(); // (remote, local, size)

    if meta.is_dir() {
        std::fs::create_dir_all(&target_root).map_err(|e| e.to_string())?;
        let mut stack = vec![(remote_path.to_string(), target_root.clone())];
        while let Some((r, l)) = stack.pop() {
            let m = sftp.metadata(r.clone()).await.map_err(|e| e.to_string())?;
            if m.is_dir() {
                std::fs::create_dir_all(&l).map_err(|e| e.to_string())?;
                for entry in sftp.read_dir(r.clone()).await.map_err(|e| e.to_string())? {
                    let name = entry.file_name();
                    stack.push((join_path(&r, &name), join_path(&l, &name)));
                }
            } else {
                files.push((r, l, m.size.unwrap_or(0)));
            }
        }
    } else {
        files.push((remote_path.to_string(), target_root.clone(), meta.size.unwrap_or(0)));
    }

    let total: u64 = files.iter().map(|f| f.2).sum();
    let _ = ch.send(TransferEvent::Started {
        total,
        files: files.len() as u64,
    });

    let count = files.len() as u64;
    let mut prog = Prog { transferred: 0, total, last: 0 };
    let mut buf = vec![0u8; 32 * 1024];
    for (i, (r, l, _)) in files.iter().enumerate() {
        if cancel.load(Ordering::Relaxed) {
            return Ok(false);
        }
        let name = basename(r);
        let _ = ch.send(TransferEvent::File {
            index: i as u64 + 1,
            count,
            name: name.clone(),
        });
        let mut src = sftp.open(r.clone()).await.map_err(|e| e.to_string())?;
        let mut dst = tokio::fs::File::create(l).await.map_err(|e| e.to_string())?;
        loop {
            if cancel.load(Ordering::Relaxed) {
                return Ok(false);
            }
            let n = src.read(&mut buf).await.map_err(|e| e.to_string())?;
            if n == 0 {
                break;
            }
            dst.write_all(&buf[..n]).await.map_err(|e| e.to_string())?;
            prog.bump(n as u64, &name, ch);
        }
        dst.flush().await.ok();
    }
    Ok(true)
}
