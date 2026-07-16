use aes_gcm::{
    aead::{Aead, AeadCore, KeyInit, OsRng},
    Aes256Gcm, Key, Nonce,
};
use pbkdf2::pbkdf2_hmac;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use std::collections::HashMap;
use std::fs;
use tauri::{AppHandle, Manager};

#[derive(Serialize, Deserialize)]
struct Profile {
    id: String,
}

#[derive(Serialize, Deserialize)]
struct SyncPayload {
    store_json: String,
    secrets: HashMap<String, String>,
}

pub fn get_sync_payload(app: &AppHandle) -> Result<String, String> {
    let app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let store_path = app_data_dir.join("store.json");

    let store_json = if store_path.exists() {
        fs::read_to_string(&store_path).map_err(|e| e.to_string())?
    } else {
        "{}".to_string()
    };

    let mut secrets_map = HashMap::new();

    if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&store_json) {
        if let Some(profiles) = parsed.get("profiles").and_then(|p| p.as_array()) {
            for p in profiles {
                if let Some(id) = p.get("id").and_then(|id| id.as_str()) {
                    #[cfg(desktop)]
                    if let Ok(Some(secret)) = crate::secrets::backend::get(id) {
                        secrets_map.insert(id.to_string(), secret);
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

pub fn apply_sync_payload(app: &AppHandle, payload_json: &str) -> Result<(), String> {
    let payload: SyncPayload = serde_json::from_str(payload_json).map_err(|e| e.to_string())?;

    let app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let store_path = app_data_dir.join("store.json");

    if let Some(parent) = store_path.parent() {
        fs::create_dir_all(parent).ok();
    }
    fs::write(&store_path, payload.store_json).map_err(|e| e.to_string())?;

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
    OsRng.fill_bytes(&mut salt);

    let mut key = [0u8; 32];
    pbkdf2_hmac::<Sha256>(password.as_bytes(), &salt, 100_000, &mut key);

    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key));
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);

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

    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key));
    let nonce = Nonce::from_slice(nonce_bytes);

    let plaintext = cipher
        .decrypt(nonce, ciphertext)
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
