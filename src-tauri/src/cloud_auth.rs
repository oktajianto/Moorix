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
        scope=https://www.googleapis.com/auth/drive.appdata&\
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
                            let html = "<html><body><h1>Login Berhasil!</h1><p>Anda bisa menutup tab ini dan kembali ke aplikasi.</p></body></html>";
                            let response = Response::from_string(html);
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
