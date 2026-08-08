mod commands;
mod db;
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

/// Enable/disable tray mode: when on, closing/minimizing the window hides it to
/// the tray instead of quitting (Fase 23D-2). The frontend sets this from whether
/// auto-backup or autostart is enabled.
#[tauri::command]
fn set_tray_mode(state: tauri::State<AppState>, enabled: bool) {
    state.set_tray_mode(enabled);
}

/// Title-bar minimize button: hide to tray when tray mode is on, otherwise a
/// normal minimize (Fase 23D-2).
#[tauri::command]
fn window_minimize(state: tauri::State<AppState>, window: tauri::WebviewWindow) {
    if state.tray_mode() {
        let _ = window.hide();
    } else {
        let _ = window.minimize();
    }
}

/// Payload for the `backup-activity` event the banner window listens to.
#[cfg(desktop)]
#[derive(Clone, serde::Serialize)]
struct BackupActivity {
    active: bool,
    label: String,
}

/// Reflect backup activity in two places (Fase 23D / 23E): the tray icon tooltip
/// (hover near the clock) **and** a small always-on-top banner in the bottom-right
/// corner, above the taskbar, so an in-progress backup is visible even while the
/// main window is hidden to the tray.
#[tauri::command]
fn set_backup_activity(app: tauri::AppHandle, active: bool, label: String) {
    #[cfg(desktop)]
    {
        use tauri::{Emitter, Manager};
        if let Some(tray) = app.tray_by_id("main") {
            let tip = if active {
                if label.is_empty() {
                    "Moorix — Backup running…".to_string()
                } else {
                    format!("Moorix — Backup running: {label}")
                }
            } else {
                "Moorix".to_string()
            };
            let _ = tray.set_tooltip(Some(tip));
        }

        // Drive the desktop progress banner: show it while a backup runs (and let
        // it re-read the label via the event), hide it when everything is idle.
        if let Some(win) = app.get_webview_window("backup-banner") {
            let _ = app.emit_to(
                "backup-banner",
                "backup-activity",
                BackupActivity { active, label: label.clone() },
            );
            if active {
                let _ = win.show();
                let _ = win.set_always_on_top(true);
            } else {
                let _ = win.hide();
            }
        }
    }
    #[cfg(not(desktop))]
    {
        let _ = (app, active, label);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    // Single-instance MUST be the very first plugin (Tauri requirement): when a
    // second Moorix is launched (e.g. autostart already put one in the tray and
    // the user double-clicks the app), don't spawn another process/tray icon —
    // just surface the running window. Desktop-only; mobile is single-instance
    // by platform.
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            show_main_window(app);
        }));
    }

    builder = builder
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_store::Builder::new().build());

    // Auto-update + relaunch + autostart are desktop-only; mobile updates ship via
    // app stores and has no login-item concept.
    #[cfg(desktop)]
    {
        builder = builder
            .plugin(tauri_plugin_updater::Builder::new().build())
            .plugin(tauri_plugin_process::init())
            .plugin(tauri_plugin_autostart::init(
                tauri_plugin_autostart::MacosLauncher::LaunchAgent,
                // Passed to the launched instance so it can start hidden-to-tray
                // (Fase 23D-2). Harmless when launched manually.
                Some(vec!["--autostart"]),
            ));
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
            ssh::trust_host_key,
            ssh::forget_host_key,
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
            sftp::sftp_read_text,
            sftp::sftp_write,
            sftp::sftp_checksum,
            sftp::sftp_compress,
            sftp::sftp_extract,
            sftp::sftp_paste,
            localfs::local_home,
            localfs::local_download_dir,
            localfs::local_list,
            localfs::local_mkdir,
            localfs::local_rename,
            localfs::local_remove,
            localfs::local_preview,
            localfs::local_read_text,
            localfs::local_write,
            localfs::local_checksum,
            localfs::local_compress,
            localfs::local_extract,
            localfs::local_paste,
            sync::export_sync_data,
            sync::import_sync_data,
            cloud_auth::start_google_login,
            cloud_auth::exchange_google_token,
            cloud_auth::google_user_info,
            cloud_auth::google_logout,
            cloud_auth::google_refresh_token,
            cloud_auth::drive_upload_appdata,
            cloud_auth::drive_download_appdata,
            cloud_auth::drive_appdata_modified,
            db::db_test_connect,
            db::db_open,
            db::db_list_databases,
            db::db_list_schemas,
            db::db_list_tables,
            db::db_close,
            db::db_run_sql,
            db::db_browse,
            db::db_schema,
            db::db_table_structure,
            db::db_update_row,
            db::db_delete_row,
            db::db_insert_row,
            db::db_export_sql,
            db::db_backup_run,
            db::db_import_sql,
            db::db_drop_table,
            db::db_rename_table,
            db::db_drop_database,
            db::db_rename_database,
            db::db_create_database,
            db::db_create_table,
            db::db_add_column,
            db::db_modify_column,
            db::db_drop_column,
            db::db_apply_enum,
            open_devtools,
            set_backup_activity,
            set_tray_mode,
            window_minimize,
        ])
        .on_window_event(|window, event| {
            // Tray mode (Fase 23D-2): closing the window hides it to the tray
            // instead of quitting, so background auto-backup keeps working.
            #[cfg(desktop)]
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                use tauri::Manager;
                if window.state::<AppState>().tray_mode() {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
            let _ = (window, event);
        })
        .setup(|app| {
            #[cfg(desktop)]
            {
                build_tray(app)?;
                // Launched at login via autostart (`--autostart`)? Stay hidden in
                // the tray; otherwise show the window (it starts hidden, see conf).
                use tauri::Manager;
                let autostarted = std::env::args().any(|a| a == "--autostart");
                if let Some(w) = app.get_webview_window("main") {
                    if !autostarted {
                        let _ = w.show();
                    }
                }
            }
            let _ = app;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// Build the system-tray icon (id `main`) with a Show/Quit menu. Its tooltip is
/// updated live via `set_backup_activity` to show backup progress near the clock.
#[cfg(desktop)]
fn build_tray(app: &tauri::App) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItem};
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};

    let show = MenuItem::with_id(app, "show", "Open Moorix", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;

    let icon = app
        .default_window_icon()
        .cloned()
        .expect("app has a default window icon");

    TrayIconBuilder::with_id("main")
        .icon(icon)
        .tooltip("Moorix")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_main_window(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

/// Show, unminimize, and focus the main window (from tray click / menu).
#[cfg(desktop)]
fn show_main_window(app: &tauri::AppHandle) {
    use tauri::Manager;
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}
