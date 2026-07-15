//! Local filesystem browsing for the SFTP file manager's "local" pane. Paths
//! use "/" separators, which Windows accepts too. Desktop is the target; on
//! mobile the sandboxed FS makes this largely moot but the commands still
//! compile.

use std::fs;
use std::time::UNIX_EPOCH;

use serde::Serialize;
use tauri::{AppHandle, Manager};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalEntry {
    pub name: String,
    pub is_dir: bool,
    pub size: u64,
    /// Unix mtime (seconds), 0 if unknown.
    pub mtime: i64,
}

/// The user's home directory, as the initial local path.
#[tauri::command]
pub fn local_home(app: AppHandle) -> Result<String, String> {
    app.path()
        .home_dir()
        .map(|p| p.to_string_lossy().replace('\\', "/"))
        .map_err(|e| e.to_string())
}

/// List a local directory.
#[tauri::command]
pub fn local_list(path: String) -> Result<Vec<LocalEntry>, String> {
    let mut out = Vec::new();
    for entry in fs::read_dir(&path).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let md = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue, // skip entries we can't stat (permissions, etc.)
        };
        let mtime = md
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);
        out.push(LocalEntry {
            name: entry.file_name().to_string_lossy().into_owned(),
            is_dir: md.is_dir(),
            size: md.len(),
            mtime,
        });
    }
    Ok(out)
}

#[tauri::command]
pub fn local_mkdir(path: String) -> Result<(), String> {
    fs::create_dir_all(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn local_rename(from: String, to: String) -> Result<(), String> {
    fs::rename(&from, &to).map_err(|e| e.to_string())
}

/// Remove a local file, or a directory and everything under it.
#[tauri::command]
pub fn local_remove(path: String) -> Result<(), String> {
    let md = fs::metadata(&path).map_err(|e| e.to_string())?;
    if md.is_dir() {
        fs::remove_dir_all(&path).map_err(|e| e.to_string())
    } else {
        fs::remove_file(&path).map_err(|e| e.to_string())
    }
}
