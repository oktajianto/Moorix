//! Secret storage for SSH passwords, keyed by profile id.
//!
//! - **Desktop:** the OS keychain via the `keyring` crate (Windows Credential
//!   Manager / macOS Keychain / Linux Secret Service).
//! - **Mobile:** an in-memory store for the app session only — nothing is
//!   persisted, matching the "secrets live in memory only" security stance. A
//!   native encrypted store (Android EncryptedSharedPreferences / iOS Keychain)
//!   will replace this once the mobile plugin is scaffolded.

#[cfg(desktop)]
mod backend {
    use keyring::{Entry, Error};

    const SERVICE: &str = "moorix";

    pub fn set(id: &str, password: &str) -> Result<(), String> {
        let entry = Entry::new(SERVICE, id).map_err(|e| e.to_string())?;
        entry.set_password(password).map_err(|e| e.to_string())
    }

    pub fn get(id: &str) -> Result<Option<String>, String> {
        let entry = Entry::new(SERVICE, id).map_err(|e| e.to_string())?;
        match entry.get_password() {
            Ok(p) => Ok(Some(p)),
            Err(Error::NoEntry) => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    }

    pub fn delete(id: &str) -> Result<(), String> {
        let entry = Entry::new(SERVICE, id).map_err(|e| e.to_string())?;
        match entry.delete_credential() {
            Ok(()) | Err(Error::NoEntry) => Ok(()),
            Err(e) => Err(e.to_string()),
        }
    }
}

#[cfg(mobile)]
mod backend {
    use std::collections::HashMap;
    use std::sync::{Mutex, OnceLock};

    fn store() -> &'static Mutex<HashMap<String, String>> {
        static STORE: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();
        STORE.get_or_init(|| Mutex::new(HashMap::new()))
    }

    pub fn set(id: &str, password: &str) -> Result<(), String> {
        store().lock().unwrap().insert(id.to_string(), password.to_string());
        Ok(())
    }

    pub fn get(id: &str) -> Result<Option<String>, String> {
        Ok(store().lock().unwrap().get(id).cloned())
    }

    pub fn delete(id: &str) -> Result<(), String> {
        store().lock().unwrap().remove(id);
        Ok(())
    }
}

/// Store a secret (e.g. an SSH password), keyed by id.
#[tauri::command]
pub fn secret_set(id: String, password: String) -> Result<(), String> {
    backend::set(&id, &password)
}

/// Retrieve a secret. Returns None if not set.
#[tauri::command]
pub fn secret_get(id: String) -> Result<Option<String>, String> {
    backend::get(&id)
}

/// Remove a secret (no-op if absent).
#[tauri::command]
pub fn secret_delete(id: String) -> Result<(), String> {
    backend::delete(&id)
}
