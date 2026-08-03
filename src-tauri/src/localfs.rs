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
    pub is_symlink: bool,
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
            is_symlink: entry.file_type().map(|ft| ft.is_symlink()).unwrap_or(false),
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

/// Read a chunk of a local file for preview (up to 512KB).
#[tauri::command]
pub fn local_preview(path: String) -> Result<Vec<u8>, String> {
    use std::io::Read;
    let file = fs::File::open(&path).map_err(|e| e.to_string())?;
    let mut buf = Vec::new();
    file.try_clone()
        .unwrap_or(file)
        .take(512 * 1024)
        .read_to_end(&mut buf)
        .map_err(|e| e.to_string())?;
    Ok(buf)
}

/// Read a local text file *in full* for editing. Mirrors `sftp_read_text`:
/// refuses files over the hard cap, binary files (NUL byte), and non-UTF-8
/// content. Distinct from `local_preview`, which is truncated.
#[tauri::command]
pub fn local_read_text(path: String) -> Result<String, String> {
    let md = fs::metadata(&path).map_err(|e| e.to_string())?;
    if md.len() > crate::sftp::EDIT_HARD_CAP {
        return Err(format!(
            "File too large to edit ({} bytes; max {} bytes).",
            md.len(),
            crate::sftp::EDIT_HARD_CAP
        ));
    }
    let buf = fs::read(&path).map_err(|e| e.to_string())?;
    if buf.contains(&0) {
        return Err("Binary file — cannot edit as text.".to_string());
    }
    String::from_utf8(buf).map_err(|_| "File is not valid UTF-8 text.".to_string())
}

/// Overwrite a local file with `content` (UTF-8).
#[tauri::command]
pub fn local_write(path: String, content: String) -> Result<(), String> {
    fs::write(&path, content.as_bytes()).map_err(|e| e.to_string())
}

/// SHA-256 (hex) of a local file, streamed so large files don't buffer.
#[tauri::command]
pub fn local_checksum(path: String) -> Result<String, String> {
    use sha2::{Digest, Sha256};
    use std::io::Read;
    let mut file = fs::File::open(&path).map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 64 * 1024];
    loop {
        let n = file.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    let mut s = String::with_capacity(64);
    for b in hasher.finalize() {
        s.push_str(&format!("{b:02x}"));
    }
    Ok(s)
}


/// The `tar` to use for local archives. On Windows we pin the System32 bsdtar
/// (libarchive): it creates real `.zip`/`.tar.gz` from the extension (`-a`) and
/// extracts any format (`-xf`). A Git/MSYS **GNU** tar that happens to be earlier
/// in PATH can't create or read zips, so relying on bare `tar` silently produced
/// a mislabeled tar (or failed on extract) depending on how the app was launched.
fn tar_bin() -> std::ffi::OsString {
    #[cfg(windows)]
    {
        if let Ok(root) = std::env::var("SystemRoot") {
            let p = std::path::Path::new(&root).join("System32").join("tar.exe");
            if p.exists() {
                return p.into_os_string();
            }
        }
    }
    std::ffi::OsString::from("tar")
}

#[tauri::command]
pub fn local_compress(dir: String, dest: String, names: Vec<String>) -> Result<(), String> {
    let mut cmd = std::process::Command::new(tar_bin());
    cmd.current_dir(&dir);
    // -a picks the format from `dest`'s extension (.zip → zip, .tar.gz → gzip, …).
    cmd.arg("-a").arg("-c").arg("-f").arg(&dest);
    for name in names {
        cmd.arg(&name);
    }
    let out = cmd.output().map_err(|e| e.to_string())?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        let err = err.trim();
        return Err(if err.is_empty() {
            format!("tar failed: {}", out.status)
        } else {
            format!("tar failed: {}", err)
        });
    }
    Ok(())
}

#[tauri::command]
pub fn local_extract(path: String) -> Result<(), String> {
    let p = std::path::Path::new(&path);
    let dir = p.parent().unwrap_or(std::path::Path::new("."));
    let mut cmd = std::process::Command::new(tar_bin());
    cmd.current_dir(dir);
    // -xf auto-detects the archive format (zip, tar, tar.gz, …) with bsdtar.
    cmd.arg("-x").arg("-f").arg(p.file_name().unwrap());
    let out = cmd.output().map_err(|e| e.to_string())?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        let err = err.trim();
        return Err(if err.is_empty() {
            format!("tar failed: {}", out.status)
        } else {
            format!("tar failed: {}", err)
        });
    }
    Ok(())
}

#[tauri::command]
pub fn local_paste(op: String, src_dir: String, dest_dir: String, names: Vec<String>) -> Result<(), String> {
    for name in names {
        let src = std::path::Path::new(&src_dir).join(&name);
        let dst = std::path::Path::new(&dest_dir).join(&name);
        if op == "cut" {
            std::fs::rename(&src, &dst).map_err(|e| e.to_string())?;
        } else {
            copy_dir_all(&src, &dst).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

fn copy_dir_all(src: impl AsRef<std::path::Path>, dst: impl AsRef<std::path::Path>) -> std::io::Result<()> {
    if src.as_ref().is_dir() {
        std::fs::create_dir_all(&dst)?;
        for entry in std::fs::read_dir(src)? {
            let entry = entry?;
            copy_dir_all(entry.path(), dst.as_ref().join(entry.file_name()))?;
        }
    } else {
        std::fs::copy(src, dst)?;
    }
    Ok(())
}
