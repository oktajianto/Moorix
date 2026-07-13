use tauri::ipc::Channel;
use tauri::State;

use crate::pty::PtySession;
use crate::ssh::{SshConfig, SshSession};
use crate::state::{AppState, Session};

/// Open a new local shell session. `on_data` is a channel the frontend passes
/// in; the backend streams raw PTY output bytes back through it.
#[tauri::command]
pub fn session_open(
    state: State<AppState>,
    on_data: Channel<Vec<u8>>,
    cols: u16,
    rows: u16,
    shell: Option<String>,
) -> Result<String, String> {
    let session = PtySession::spawn(cols, rows, shell, on_data)?;
    let id = state.next_id();
    state.insert(id.clone(), Session::Pty(session));
    Ok(id)
}

/// Open a new SSH session and start an interactive shell on the remote host.
#[tauri::command]
pub async fn ssh_open(
    state: State<'_, AppState>,
    on_data: Channel<Vec<u8>>,
    config: SshConfig,
    cols: u16,
    rows: u16,
) -> Result<String, String> {
    let session = SshSession::connect(config, cols, rows, on_data).await?;
    let id = state.next_id();
    state.insert(id.clone(), Session::Ssh(session));
    Ok(id)
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
