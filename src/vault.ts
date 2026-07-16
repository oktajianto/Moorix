//! Master-password credential vault (frontend, Web Crypto).
//!
//! An alternative to the OS keychain: secrets are encrypted with a key derived
//! from a master password (PBKDF2-SHA256 → AES-GCM-256) and stored — encrypted
//! only — in the app store (`moorix.json` key `vault`). The derived key lives in
//! memory while unlocked and is dropped on lock. This works everywhere the app
//! runs (including mobile, where no OS keychain is wired up yet).
//!
//! Store shape (all binary values base64):
//!   { v: 1, salt, verifier: {iv, ct}, entries: { [id]: {iv, ct} } }
//! `verifier` is a known token encrypted at creation; decrypting it on unlock
//! confirms the master password without storing it.

import { getStore, setValue } from "./store";

const VAULT_KEY = "vault";
const PBKDF2_ITERATIONS = 200_000;
const VERIFIER_PLAINTEXT = "moorix-vault-v1";

type Cipher = { iv: string; ct: string };
type VaultData = {
  v: 1;
  salt: string;
  verifier: Cipher;
  entries: Record<string, Cipher>;
};

/** In-memory derived key; null when locked. */
let activeKey: CryptoKey | null = null;

/* ------------------------------- base64 utils ----------------------------- */

function toB64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
function fromB64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/* --------------------------------- crypto --------------------------------- */

async function deriveKey(master: string, salt: Uint8Array): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(master),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

async function encrypt(key: CryptoKey, plaintext: string): Promise<Cipher> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plaintext),
  );
  return { iv: toB64(iv), ct: toB64(new Uint8Array(ct)) };
}

async function decrypt(key: CryptoKey, c: Cipher): Promise<string> {
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromB64(c.iv) as BufferSource },
    key,
    fromB64(c.ct) as BufferSource,
  );
  return new TextDecoder().decode(pt);
}

/* ------------------------------ store helpers ----------------------------- */

async function readVault(): Promise<VaultData | null> {
  const store = await getStore();
  const v = await store.get<VaultData>(VAULT_KEY);
  return v && v.v === 1 ? v : null;
}

async function writeVault(v: VaultData): Promise<void> {
  await setValue(VAULT_KEY, v);
}

/* --------------------------------- public --------------------------------- */

/** Whether a vault has been set up (regardless of lock state). */
export async function vaultConfigured(): Promise<boolean> {
  return (await readVault()) !== null;
}

/** True when the vault is set up and currently unlocked. */
export function isUnlocked(): boolean {
  return activeKey !== null;
}

/** Create a brand-new vault with the given master password. Fails if one
 *  already exists (use changeMaster instead). */
export async function createVault(master: string): Promise<void> {
  if (await vaultConfigured()) throw new Error("Vault already exists");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(master, salt);
  const verifier = await encrypt(key, VERIFIER_PLAINTEXT);
  await writeVault({ v: 1, salt: toB64(salt), verifier, entries: {} });
  activeKey = key;
}

/** Unlock the vault. Returns false if the master password is wrong. */
export async function unlock(master: string): Promise<boolean> {
  const v = await readVault();
  if (!v) return false;
  try {
    const key = await deriveKey(master, fromB64(v.salt));
    const check = await decrypt(key, v.verifier);
    if (check !== VERIFIER_PLAINTEXT) return false;
    activeKey = key;
    return true;
  } catch {
    return false; // AES-GCM auth failure → wrong password
  }
}

/** Drop the in-memory key. */
export function lock(): void {
  activeKey = null;
}

/** Store (or overwrite) a secret. The vault must be unlocked. */
export async function vaultSet(id: string, secret: string): Promise<void> {
  if (!activeKey) throw new Error("Vault is locked");
  const v = await readVault();
  if (!v) throw new Error("Vault not configured");
  v.entries[id] = await encrypt(activeKey, secret);
  await writeVault(v);
}

/** Read a secret. Returns null if absent. The vault must be unlocked. */
export async function vaultGet(id: string): Promise<string | null> {
  if (!activeKey) throw new Error("Vault is locked");
  const v = await readVault();
  const c = v?.entries[id];
  if (!c) return null;
  return decrypt(activeKey, c);
}

/** Remove a secret. Works even while locked (no decryption needed). */
export async function vaultDelete(id: string): Promise<void> {
  const v = await readVault();
  if (!v || !(id in v.entries)) return;
  delete v.entries[id];
  await writeVault(v);
}

/** Re-encrypt every entry under a new master password. Requires the current
 *  password to decrypt existing entries. */
export async function changeMaster(oldMaster: string, newMaster: string): Promise<boolean> {
  const v = await readVault();
  if (!v) return false;
  let oldKey: CryptoKey;
  try {
    oldKey = await deriveKey(oldMaster, fromB64(v.salt));
    if ((await decrypt(oldKey, v.verifier)) !== VERIFIER_PLAINTEXT) return false;
  } catch {
    return false;
  }
  const newSalt = crypto.getRandomValues(new Uint8Array(16));
  const newKey = await deriveKey(newMaster, newSalt);
  const entries: Record<string, Cipher> = {};
  for (const [id, c] of Object.entries(v.entries)) {
    entries[id] = await encrypt(newKey, await decrypt(oldKey, c));
  }
  const verifier = await encrypt(newKey, VERIFIER_PLAINTEXT);
  await writeVault({ v: 1, salt: toB64(newSalt), verifier, entries });
  activeKey = newKey;
  return true;
}

/** Delete the entire vault (all stored secrets are lost). */
export async function destroyVault(): Promise<void> {
  const store = await getStore();
  await store.delete(VAULT_KEY);
  await store.save();
  activeKey = null;
}
