mod commands;
mod pty;
mod ssh;
mod state;

use state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            commands::session_open,
            commands::ssh_open,
            commands::session_write,
            commands::session_resize,
            commands::session_close,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
