mod commands;
mod forward;
mod cloud_auth;
mod localfs;
#[cfg(desktop)]
mod pty;
mod secrets;
#[cfg(desktop)]
mod serial;
mod sftp;
mod ssh;
mod state;
mod sync;
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
            sftp::sftp_open,
            sftp::sftp_list,
            sftp::sftp_realpath,
            sftp::sftp_close,
            sftp::sftp_upload,
            sftp::sftp_download,
            sftp::sftp_cancel,
            sftp::sftp_mkdir,
            sftp::sftp_rename,
            sftp::sftp_remove,
            sftp::sftp_preview,
            sftp::sftp_checksum,
            sftp::sftp_compress,
            sftp::sftp_extract,
            sftp::sftp_paste,
            localfs::local_home,
            localfs::local_list,
            localfs::local_mkdir,
            localfs::local_rename,
            localfs::local_remove,
            localfs::local_preview,
            localfs::local_checksum,
            localfs::local_compress,
            localfs::local_extract,
            localfs::local_paste,
            sync::export_sync_data,
            sync::import_sync_data,
            cloud_auth::start_google_login,
            cloud_auth::exchange_google_token,
            open_devtools,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
