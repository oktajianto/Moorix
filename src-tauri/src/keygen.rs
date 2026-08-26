//! In-app SSH keypair generation (Fase 26B). Uses the `ssh-key` crate that russh
//! already pulls in — no shelling out to `ssh-keygen`, so it works the same on
//! every platform and inside the MSIX sandbox (Fase 25, `runFullTrust`).
//!
//! The generated private key is a **per-device secret**: it is written to disk
//! here and referenced by `keyPath`, which never syncs to the account (only the
//! profile does — see `sync.rs` §26.10).

use std::convert::Infallible;
use std::fs;
use std::path::Path;

use rand_core::{TryCryptoRng, TryRng};
use russh::keys::ssh_key::private::RsaKeypair;
use russh::keys::ssh_key::{Algorithm, LineEnding, PrivateKey};

/// Default RSA modulus size when the caller doesn't specify one.
const DEFAULT_RSA_BITS: u32 = 3072;

/// `getrandom`-backed RNG that satisfies rand_core 0.10's trait surface so
/// ssh-key's `random`/`encrypt` (which want a `CryptoRng`) can draw from the OS
/// entropy source. `CryptoRng` is blanket-implemented for any
/// `TryCryptoRng<Error = Infallible>`, so implementing `TryRng` + the
/// `TryCryptoRng` marker is enough.
struct OsRng;

impl TryRng for OsRng {
    type Error = Infallible;

    fn try_next_u32(&mut self) -> Result<u32, Infallible> {
        let mut b = [0u8; 4];
        self.try_fill_bytes(&mut b)?;
        Ok(u32::from_le_bytes(b))
    }

    fn try_next_u64(&mut self) -> Result<u64, Infallible> {
        let mut b = [0u8; 8];
        self.try_fill_bytes(&mut b)?;
        Ok(u64::from_le_bytes(b))
    }

    fn try_fill_bytes(&mut self, dst: &mut [u8]) -> Result<(), Infallible> {
        // getrandom failing means the OS has no entropy source at all — the same
        // unrecoverable condition every OsRng treats as a panic.
        getrandom::fill(dst).expect("OS random source (getrandom) unavailable");
        Ok(())
    }
}

impl TryCryptoRng for OsRng {}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GeneratedKey {
    /// Absolute path to the private key file that was written.
    private_path: String,
    /// Absolute path to the `.pub` file that was written.
    public_path: String,
    /// The public key as a single `authorized_keys` line (to copy to servers).
    public_openssh: String,
}

/// Generate an SSH keypair and write it to disk. `algo` is `"ed25519"` or
/// `"rsa"` (with optional `bits`). When `passphrase` is non-empty the private
/// key is encrypted. `out_path` is the private key file; the public key is
/// written alongside as `<out_path>.pub`.
#[tauri::command]
pub fn ssh_generate_keypair(
    algo: String,
    bits: Option<u32>,
    passphrase: Option<String>,
    comment: Option<String>,
    out_path: String,
    overwrite: Option<bool>,
) -> Result<GeneratedKey, String> {
    if out_path.trim().is_empty() {
        return Err("Output path is empty".into());
    }
    let priv_path = Path::new(&out_path);
    let pub_path_string = format!("{out_path}.pub");
    let pub_path = Path::new(&pub_path_string);

    if overwrite != Some(true) {
        if priv_path.exists() {
            return Err(format!("File already exists: {out_path}"));
        }
        if pub_path.exists() {
            return Err(format!("File already exists: {pub_path_string}"));
        }
    }

    if let Some(parent) = priv_path.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent).map_err(|e| format!("create directory failed: {e}"))?;
        }
    }

    let comment = comment.unwrap_or_default();
    let mut rng = OsRng;

    let mut key = match algo.as_str() {
        "ed25519" => PrivateKey::random(&mut rng, Algorithm::Ed25519)
            .map_err(|e| format!("generate failed: {e}"))?,
        "rsa" => {
            let bits = bits.unwrap_or(DEFAULT_RSA_BITS) as usize;
            if !(2048..=8192).contains(&bits) {
                return Err("RSA key size must be between 2048 and 8192 bits".into());
            }
            let keypair =
                RsaKeypair::random(&mut rng, bits).map_err(|e| format!("generate failed: {e}"))?;
            PrivateKey::from(keypair)
        }
        other => return Err(format!("unsupported algorithm: {other}")),
    };
    key.set_comment(comment);

    // Encrypt with the passphrase when one is given (blank = unencrypted key).
    let key = match passphrase {
        Some(pw) if !pw.is_empty() => key
            .encrypt(&mut rng, pw.as_bytes())
            .map_err(|e| format!("encrypt failed: {e}"))?,
        _ => key,
    };

    let private_openssh = key
        .to_openssh(LineEnding::LF)
        .map_err(|e| format!("encode private key failed: {e}"))?;
    let public_openssh = key
        .public_key()
        .to_openssh()
        .map_err(|e| format!("encode public key failed: {e}"))?;

    fs::write(priv_path, private_openssh.as_bytes())
        .map_err(|e| format!("write private key failed: {e}"))?;
    fs::write(pub_path, format!("{public_openssh}\n"))
        .map_err(|e| format!("write public key failed: {e}"))?;

    // Lock down the private key like ssh-keygen does; the public key stays 644.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(priv_path, fs::Permissions::from_mode(0o600));
        let _ = fs::set_permissions(pub_path, fs::Permissions::from_mode(0o644));
    }

    Ok(GeneratedKey {
        private_path: out_path,
        public_path: pub_path_string,
        public_openssh,
    })
}
