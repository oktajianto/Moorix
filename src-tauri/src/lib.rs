mod commands;
#[cfg(desktop)]
mod pty;
mod secrets;
mod ssh;
mod state;

use state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            commands::session_open,
            commands::ssh_open,
            commands::session_write,
            commands::session_resize,
            commands::session_close,
            commands::host_key_decision,
            secrets::secret_set,
            secrets::secret_get,
            secrets::secret_delete,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
