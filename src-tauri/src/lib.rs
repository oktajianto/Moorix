mod commands;
mod forward;
#[cfg(desktop)]
mod pty;
mod secrets;
#[cfg(desktop)]
mod serial;
mod ssh;
mod state;
mod telnet;

use state::AppState;

/// Open the webview devtools (exposed in Settings → Application → Debugging).
/// The `tauri` crate is built with the `devtools` feature, so `open_devtools`
/// is available in release builds too — not just debug.
#[tauri::command]
fn open_devtools(window: tauri::WebviewWindow) {
    window.open_devtools();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_store::Builder::new().build());

    // Auto-update + relaunch are desktop-only; mobile updates ship via app stores.
    #[cfg(desktop)]
    {
        builder = builder
            .plugin(tauri_plugin_updater::Builder::new().build())
            .plugin(tauri_plugin_process::init());
    }

    builder
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            commands::session_open,
            commands::ssh_open,
            commands::serial_open,
            commands::serial_ports,
            commands::telnet_open,
            commands::session_write,
            commands::session_resize,
            commands::session_close,
            commands::host_key_decision,
            secrets::secret_set,
            secrets::secret_get,
            secrets::secret_delete,
            open_devtools,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
