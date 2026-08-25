use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use pbkdf2::pbkdf2_hmac;
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use std::collections::HashMap;
use std::fs;
use tauri::{AppHandle, Manager};
use tauri_plugin_store::StoreExt;

#[derive(Serialize, Deserialize)]
struct Profile {
    id: String,
}

#[derive(Serialize, Deserialize)]
struct SyncPayload {
    store_json: String,
    secrets: HashMap<String, String>,
}

/// Store keys that are per-device and must never sync: kept out of the exported
/// payload, and skipped on import so a pull can't overwrite this machine's value.
/// - `googleAccount`: this device's Google session.
/// - `dbBackup` / `dbBackupRuns`: auto-backup jobs + run markers must stay local,
///   so signing the same account into another computer doesn't make it back up
///   too (Fase 23 — user 2026-08-06).
const LOCAL_ONLY_KEYS: [&str; 3] = ["googleAccount", "dbBackup", "dbBackupRuns"];

pub fn get_sync_payload(app: &AppHandle) -> Result<String, String> {
    let app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let store_path = app_data_dir.join("moorix.json");

    let mut store_json = if store_path.exists() {
        fs::read_to_string(&store_path).map_err(|e| e.to_string())?
    } else {
        "{}".to_string()
    };

    // Strip per-device keys (Google session, auto-backup config/markers) from the
    // synced payload so a pull on another machine never overwrites (or leaks) them.
    // Also blank each profile's `ssh.keyPath`: a private key is a per-device secret
    // (Fase 26 — user 2026-08-26), so only the profile syncs. The key passphrase is
    // already local-only because it lives in the keychain under a "#keyPassphrase"
    // id that the secret-gathering below never collects.
    if let Ok(mut parsed) = serde_json::from_str::<serde_json::Value>(&store_json) {
        if let Some(obj) = parsed.as_object_mut() {
            let mut changed = false;
            for key in LOCAL_ONLY_KEYS {
                if obj.remove(key).is_some() {
                    changed = true;
                }
            }
            if let Some(profiles) = obj.get_mut("userProfiles").and_then(|p| p.as_array_mut()) {
                for p in profiles {
                    if let Some(kp) = p.get_mut("ssh").and_then(|s| s.get_mut("keyPath")) {
                        if kp.as_str().map(|v| !v.is_empty()).unwrap_or(false) {
                            *kp = serde_json::Value::String(String::new());
                            changed = true;
                        }
                    }
                }
            }
            if changed {
                store_json = serde_json::to_string(&parsed).map_err(|e| e.to_string())?;
            }
        }
    }

    let mut secrets_map = HashMap::new();

    if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&store_json) {
        // User SSH/Serial/Telnet profiles live under the "userProfiles" store
        // key; their passwords are kept in the OS keychain (id = profile id).
        if let Some(profiles) = parsed.get("userProfiles").and_then(|p| p.as_array()) {
            for p in profiles {
                if let Some(id) = p.get("id").and_then(|id| id.as_str()) {
                    #[cfg(desktop)]
                    if let Ok(Some(secret)) = crate::secrets::backend::get(id) {
                        secrets_map.insert(id.to_string(), secret);
                    }
                }
                // Each profile's DB children keep their password in the keychain
                // keyed by the DBProfile id (see App.saveProfile). Gather those
                // too — otherwise a pull on another device restores the DB
                // profiles but not their passwords, so Connect can't log in.
                if let Some(dbs) = p.get("databases").and_then(|d| d.as_array()) {
                    for d in dbs {
                        if let Some(did) = d.get("id").and_then(|id| id.as_str()) {
                            #[cfg(desktop)]
                            if let Ok(Some(secret)) = crate::secrets::backend::get(did) {
                                secrets_map.insert(did.to_string(), secret);
                            }
                        }
                    }
                }
            }
        }
    }

    let payload = SyncPayload {
        store_json,
        secrets: secrets_map,
    };

    serde_json::to_string(&payload).map_err(|e| e.to_string())
}

/// Build a `profile id -> non-empty keyPath` map from the local `userProfiles`.
fn local_key_path_map(local: Option<serde_json::Value>) -> HashMap<String, String> {
    let mut map = HashMap::new();
    if let Some(arr) = local.as_ref().and_then(|v| v.as_array()) {
        for p in arr {
            let id = p.get("id").and_then(|v| v.as_str());
            let kp = p
                .get("ssh")
                .and_then(|s| s.get("keyPath"))
                .and_then(|v| v.as_str())
                .filter(|v| !v.is_empty());
            if let (Some(id), Some(kp)) = (id, kp) {
                map.insert(id.to_string(), kp.to_string());
            }
        }
    }
    map
}

/// Re-inject the local keyPath into each incoming profile whose id we already
/// have, so a pull never wipes this device's private-key binding (§26.10).
fn with_local_key_paths(
    mut incoming: serde_json::Value,
    local_key_paths: &HashMap<String, String>,
) -> serde_json::Value {
    if let Some(arr) = incoming.as_array_mut() {
        for p in arr.iter_mut() {
            let id = p.get("id").and_then(|v| v.as_str()).map(String::from);
            if let Some(id) = id {
                if let Some(kp) = local_key_paths.get(&id) {
                    if let Some(ssh) = p.get_mut("ssh").and_then(|s| s.as_object_mut()) {
                        ssh.insert(
                            "keyPath".to_string(),
                            serde_json::Value::String(kp.clone()),
                        );
                    }
                }
            }
        }
    }
    incoming
}

pub fn apply_sync_payload(app: &AppHandle, payload_json: &str) -> Result<(), String> {
    let payload: SyncPayload = serde_json::from_str(payload_json).map_err(|e| e.to_string())?;
    let incoming: serde_json::Value =
        serde_json::from_str(&payload.store_json).map_err(|e| e.to_string())?;

    // Apply the imported config THROUGH the store plugin, not a raw file write.
    // The plugin keeps moorix.json cached in memory; writing the file behind its
    // back lets that stale cache clobber the import on the next save/relaunch
    // (which is exactly why pulled profiles vanished). Per-device keys are already
    // stripped from the payload, but skip them here too as belt-and-suspenders so
    // an older payload can't overwrite this device's sign-in or backup setup.
    let store = app.store("moorix.json").map_err(|e| e.to_string())?;
    // Snapshot this device's keyPath per profile id BEFORE applying the import.
    // Private keys never travel in the payload (get_sync_payload blanks
    // `ssh.keyPath`), so we re-apply the local keyPath for profiles this machine
    // already has. A profile that only exists remotely arrives with an empty
    // keyPath — the user points it at a key here (Fase 26 §26.10).
    let local_key_paths = local_key_path_map(store.get("userProfiles"));
    if let Some(obj) = incoming.as_object() {
        for (key, value) in obj {
            if LOCAL_ONLY_KEYS.contains(&key.as_str()) {
                continue;
            }
            if key == "userProfiles" {
                store.set(key.clone(), with_local_key_paths(value.clone(), &local_key_paths));
            } else {
                store.set(key.clone(), value.clone());
            }
        }
    }
    store.save().map_err(|e| e.to_string())?;

    #[cfg(desktop)]
    for (id, secret) in payload.secrets {
        crate::secrets::backend::set(&id, &secret)?;
    }

    Ok(())
}

const SALT_LEN: usize = 16;
const NONCE_LEN: usize = 12;

pub fn encrypt_data(password: &str, data: &str) -> Result<Vec<u8>, String> {
    let mut salt = [0u8; SALT_LEN];
    getrandom::fill(&mut salt).map_err(|_| "Failed to generate random salt".to_string())?;

    let mut key = [0u8; 32];
    pbkdf2_hmac::<Sha256>(password.as_bytes(), &salt, 100_000, &mut key);

    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|_| "Invalid key length".to_string())?;
    let mut nonce_bytes = [0u8; NONCE_LEN];
    getrandom::fill(&mut nonce_bytes).map_err(|_| "Failed to generate random nonce".to_string())?;
    let nonce = Nonce::from(nonce_bytes);

    let ciphertext = cipher
        .encrypt(&nonce, data.as_bytes())
        .map_err(|_| "Encryption failed".to_string())?;

    let mut output = Vec::new();
    output.extend_from_slice(&salt);
    output.extend_from_slice(&nonce);
    output.extend_from_slice(&ciphertext);

    Ok(output)
}

pub fn decrypt_data(password: &str, data: &[u8]) -> Result<String, String> {
    if data.len() < SALT_LEN + NONCE_LEN {
        return Err("Data too short".to_string());
    }

    let salt = &data[0..SALT_LEN];
    let nonce_bytes = &data[SALT_LEN..SALT_LEN + NONCE_LEN];
    let ciphertext = &data[SALT_LEN + NONCE_LEN..];

    let mut key = [0u8; 32];
    pbkdf2_hmac::<Sha256>(password.as_bytes(), salt, 100_000, &mut key);

    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|_| "Invalid key length".to_string())?;
    let nonce = Nonce::try_from(nonce_bytes).map_err(|_| "Invalid nonce".to_string())?;

    let plaintext = cipher
        .decrypt(&nonce, ciphertext)
        .map_err(|_| "Decryption failed or incorrect password".to_string())?;

    String::from_utf8(plaintext).map_err(|_| "Invalid UTF-8".to_string())
}

#[tauri::command]
pub fn export_sync_data(app: tauri::AppHandle, password: &str) -> Result<Vec<u8>, String> {
    let json = get_sync_payload(&app)?;
    encrypt_data(password, &json)
}

#[tauri::command]
pub fn import_sync_data(app: tauri::AppHandle, password: &str, data: Vec<u8>) -> Result<(), String> {
    let json = decrypt_data(password, &data)?;
    apply_sync_payload(&app, &json)
}
