use reqwest::Client;
use serde::{Deserialize, Serialize};
use tiny_http::{Response, Server};

#[derive(Serialize, Deserialize, Debug)]
pub struct OAuthToken {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_in: u64,
    pub token_type: String,
}

const CLIENT_ID: &str = "716246034426-2pcvgll31hkeao5h1a69f8d39jllm8d5.apps.googleusercontent.com";
// Supplied at build time via the MOORIX_GOOGLE_CLIENT_SECRET env var
// (set locally in src-tauri/.cargo/config.toml, which is gitignored).
const CLIENT_SECRET: &str = match option_env!("MOORIX_GOOGLE_CLIENT_SECRET") {
    Some(s) => s,
    None => "",
};
const REDIRECT_URI: &str = "http://127.0.0.1:8484/callback";

#[tauri::command]
pub fn start_google_login(app: tauri::AppHandle) -> Result<String, String> {
    let auth_url = format!(
        "https://accounts.google.com/o/oauth2/v2/auth?\
        client_id={}&\
        redirect_uri={}&\
        response_type=code&\
        scope=openid%20email%20profile%20https://www.googleapis.com/auth/drive.appdata&\
        access_type=offline&\
        prompt=consent",
        CLIENT_ID, REDIRECT_URI
    );

    // Open the user's browser
    #[cfg(desktop)]
    {
        use tauri_plugin_opener::OpenerExt;
        if let Err(e) = app.opener().open_url(&auth_url, None::<&str>) {
            return Err(format!("Gagal membuka browser: {}", e));
        }
    }

    // Start local server to catch the callback
    let server = Server::http("127.0.0.1:8484").map_err(|e| e.to_string())?;

    for request in server.incoming_requests() {
        let url = request.url().to_string();
        if url.starts_with("/callback") {
            // parse ?code=...
            if let Some(query) = url.split('?').nth(1) {
                for pair in query.split('&') {
                    let mut parts = pair.split('=');
                    if parts.next() == Some("code") {
                        if let Some(code) = parts.next() {
                            let html = "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><title>Moorix</title></head><body style=\"font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#0f172a;color:#e2e8f0\"><div style=\"text-align:center\"><h1 style=\"color:#22c55e\">Login Berhasil!</h1><p>Anda bisa menutup tab ini dan kembali ke aplikasi Moorix.</p></div></body></html>";
                            let response = Response::from_string(html).with_header(
                                "Content-Type: text/html; charset=utf-8"
                                    .parse::<tiny_http::Header>()
                                    .unwrap(),
                            );
                            let _ = request.respond(response);
                            return Ok(code.to_string());
                        }
                    }
                }
            }
            let response = Response::from_string("Gagal mendapatkan kode.");
            let _ = request.respond(response);
            return Err("Authorization failed.".to_string());
        }
    }

    Err("Server timeout".to_string())
}

#[tauri::command]
pub async fn exchange_google_token(code: String) -> Result<OAuthToken, String> {
    let mut params = vec![
        ("code", code.as_str()),
        ("client_id", CLIENT_ID),
        ("redirect_uri", REDIRECT_URI),
        ("grant_type", "authorization_code"),
    ];
    if !CLIENT_SECRET.is_empty() {
        params.push(("client_secret", CLIENT_SECRET));
    }

    let client = Client::new();
    let res = client
        .post("https://oauth2.googleapis.com/token")
        .form(&params)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if res.status().is_success() {
        let token: OAuthToken = res.json().await.map_err(|e| e.to_string())?;
        Ok(token)
    } else {
        Err(res.text().await.unwrap_or_default())
    }
}

#[derive(Serialize, Deserialize, Debug)]
pub struct GoogleUser {
    pub email: String,
    pub name: Option<String>,
    pub picture: Option<String>,
}

#[tauri::command]
pub async fn google_user_info(access_token: String) -> Result<GoogleUser, String> {
    let client = Client::new();
    let res = client
        .get("https://openidconnect.googleapis.com/v1/userinfo")
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if res.status().is_success() {
        res.json().await.map_err(|e| e.to_string())
    } else {
        Err(res.text().await.unwrap_or_default())
    }
}

/// Trade a long-lived refresh token for a fresh access token, so sync can run
/// without re-prompting the browser login every time.
#[tauri::command]
pub async fn google_refresh_token(refresh_token: String) -> Result<OAuthToken, String> {
    let mut params = vec![
        ("refresh_token", refresh_token.as_str()),
        ("client_id", CLIENT_ID),
        ("grant_type", "refresh_token"),
    ];
    if !CLIENT_SECRET.is_empty() {
        params.push(("client_secret", CLIENT_SECRET));
    }

    let client = Client::new();
    let res = client
        .post("https://oauth2.googleapis.com/token")
        .form(&params)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if res.status().is_success() {
        // Note: refresh responses usually omit refresh_token (it stays valid).
        res.json().await.map_err(|e| e.to_string())
    } else {
        Err(res.text().await.unwrap_or_default())
    }
}

const DRIVE_FILES_URL: &str = "https://www.googleapis.com/drive/v3/files";
const DRIVE_UPLOAD_URL: &str = "https://www.googleapis.com/upload/drive/v3/files";

/// Find a file by name inside the hidden appDataFolder. Ok(None) = not found.
async fn drive_find_file(
    client: &Client,
    access_token: &str,
    name: &str,
) -> Result<Option<String>, String> {
    let q = format!("name = '{}' and trashed = false", name.replace('\'', "\\'"));
    let res = client
        .get(DRIVE_FILES_URL)
        .query(&[
            ("spaces", "appDataFolder"),
            ("q", q.as_str()),
            ("fields", "files(id,name)"),
            ("pageSize", "1"),
        ])
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(res.text().await.unwrap_or_default());
    }
    let v: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
    Ok(v["files"]
        .as_array()
        .and_then(|files| files.first())
        .and_then(|f| f["id"].as_str())
        .map(String::from))
}

/// Create or overwrite `name` in appDataFolder with `data`. Returns the file id.
#[tauri::command]
pub async fn drive_upload_appdata(
    access_token: String,
    name: String,
    data: Vec<u8>,
) -> Result<String, String> {
    let client = Client::new();

    if let Some(id) = drive_find_file(&client, &access_token, &name).await? {
        let res = client
            .patch(format!("{}/{}?uploadType=media", DRIVE_UPLOAD_URL, id))
            .bearer_auth(&access_token)
            .header("Content-Type", "application/octet-stream")
            .body(data)
            .send()
            .await
            .map_err(|e| e.to_string())?;
        if res.status().is_success() {
            Ok(id)
        } else {
            Err(res.text().await.unwrap_or_default())
        }
    } else {
        // Multipart create: JSON metadata part (with appDataFolder parent) + raw bytes.
        let metadata =
            serde_json::json!({ "name": name, "parents": ["appDataFolder"] }).to_string();
        let boundary = "moorix-drive-boundary";
        let mut body = Vec::new();
        body.extend_from_slice(
            format!(
                "--{b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{metadata}\r\n--{b}\r\nContent-Type: application/octet-stream\r\n\r\n",
                b = boundary
            )
            .as_bytes(),
        );
        body.extend_from_slice(&data);
        body.extend_from_slice(format!("\r\n--{}--", boundary).as_bytes());

        let res = client
            .post(format!(
                "{}?uploadType=multipart&fields=id",
                DRIVE_UPLOAD_URL
            ))
            .bearer_auth(&access_token)
            .header(
                "Content-Type",
                format!("multipart/related; boundary={}", boundary),
            )
            .body(body)
            .send()
            .await
            .map_err(|e| e.to_string())?;
        if res.status().is_success() {
            let v: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
            v["id"]
                .as_str()
                .map(String::from)
                .ok_or_else(|| "Upload succeeded but no file id returned".to_string())
        } else {
            Err(res.text().await.unwrap_or_default())
        }
    }
}

/// Download `name` from appDataFolder as raw bytes.
#[tauri::command]
pub async fn drive_download_appdata(access_token: String, name: String) -> Result<Vec<u8>, String> {
    let client = Client::new();
    let id = drive_find_file(&client, &access_token, &name)
        .await?
        .ok_or_else(|| "Belum ada backup Moorix di Google Drive akun ini.".to_string())?;

    let res = client
        .get(format!("{}/{}?alt=media", DRIVE_FILES_URL, id))
        .bearer_auth(&access_token)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if res.status().is_success() {
        Ok(res.bytes().await.map_err(|e| e.to_string())?.to_vec())
    } else {
        Err(res.text().await.unwrap_or_default())
    }
}

/// Best-effort token revocation; local sign-out should succeed even if
/// Google is unreachable, so errors are swallowed.
#[tauri::command]
pub async fn google_logout(token: String) -> Result<(), String> {
    let client = Client::new();
    let _ = client
        .post("https://oauth2.googleapis.com/revoke")
        .form(&[("token", token.as_str())])
        .send()
        .await;
    Ok(())
}
