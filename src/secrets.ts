//! Unified secret access. Profiles reference secrets by id and never care where
//! they live:
//!
//! - If a master-password **vault** is configured, secrets go there (encrypted
//!   with the master password; requires an unlock). Works on every platform.
//! - Otherwise the OS keychain via the `secret_*` Tauri commands (desktop) or
//!   the in-memory mobile fallback.
//!
//! When the vault is configured but locked, `secretGet`/`secretSet` ask the UI
//! to unlock via the handler registered with `setVaultUnlockHandler`.

import { invoke } from "@tauri-apps/api/core";
import {
  vaultConfigured,
  isUnlocked,
  vaultGet,
  vaultSet,
  vaultDelete,
} from "./vault";

/** UI-provided unlock prompt. Resolves true once unlocked, false if cancelled. */
let unlockHandler: (() => Promise<boolean>) | null = null;
export function setVaultUnlockHandler(fn: (() => Promise<boolean>) | null): void {
  unlockHandler = fn;
}

async function ensureUnlocked(): Promise<boolean> {
  if (isUnlocked()) return true;
  if (unlockHandler) return unlockHandler();
  return false;
}

/** Store a secret keyed by profile id. */
export async function secretSet(id: string, password: string): Promise<void> {
  if (await vaultConfigured()) {
    if (!(await ensureUnlocked())) throw new Error("Vault is locked");
    await vaultSet(id, password);
    return;
  }
  await invoke("secret_set", { id, password });
}

/** Retrieve a secret, or null if absent / the vault stays locked. */
export async function secretGet(id: string): Promise<string | null> {
  if (await vaultConfigured()) {
    if (!(await ensureUnlocked())) return null;
    return vaultGet(id);
  }
  return invoke<string | null>("secret_get", { id });
}

/** Remove a secret from wherever it lives (both, to avoid leftovers). */
export async function secretDelete(id: string): Promise<void> {
  if (await vaultConfigured()) {
    await vaultDelete(id);
  }
  await invoke("secret_delete", { id }).catch(() => {});
}
