use keyring::{Entry, Error};

const SERVICE: &str = "moorix";

/// Store a secret (e.g. an SSH password) in the OS keychain, keyed by id.
#[tauri::command]
pub fn secret_set(id: String, password: String) -> Result<(), String> {
    let entry = Entry::new(SERVICE, &id).map_err(|e| e.to_string())?;
    entry.set_password(&password).map_err(|e| e.to_string())
}

/// Retrieve a secret from the OS keychain. Returns None if not set.
#[tauri::command]
pub fn secret_get(id: String) -> Result<Option<String>, String> {
    let entry = Entry::new(SERVICE, &id).map_err(|e| e.to_string())?;
    match entry.get_password() {
        Ok(p) => Ok(Some(p)),
        Err(Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

/// Remove a secret from the OS keychain (no-op if absent).
#[tauri::command]
pub fn secret_delete(id: String) -> Result<(), String> {
    let entry = Entry::new(SERVICE, &id).map_err(|e| e.to_string())?;
    match entry.delete_credential() {
        Ok(()) | Err(Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}
