import { invoke } from "@tauri-apps/api/core";
import { relaunch } from "@tauri-apps/plugin-process";
import { getStore } from "./store";

// Same appDataFolder file name the manual Push/Pull in Settings uses.
const SYNC_DRIVE_FILE = "moorix-sync.bin";
// Sync master password, kept in the OS keychain so unattended sync needs no prompt.
const SYNC_PW_ID = "__moorix_sync_password__";
// localStorage: the Drive `modifiedTime` this device last applied/pushed. Device
// -local (not synced) so each machine knows when the remote changed under it.
const LAST_REMOTE_KEY = "moorix.sync.lastRemote";
// sessionStorage: guard so a failed/looping pull can't relaunch repeatedly.
const PULL_GUARD_KEY = "moorix.sync.pullTried";

type GoogleAccount = {
  email: string;
  accessToken: string;
  refreshToken?: string;
};

/** Whether auto-sync is enabled, read from the persisted settings blob. */
async function autoSyncEnabled(): Promise<boolean> {
  try {
    const store = await getStore();
    const s = await store.get<{ autoSync?: boolean }>("settings");
    return !!s?.autoSync;
  } catch {
    return false;
  }
}

/** A fresh Google access token, or null if not signed in / refresh failed. */
async function getAccessToken(): Promise<string | null> {
  let acc: GoogleAccount | null = null;
  try {
    const store = await getStore();
    acc = (await store.get<GoogleAccount>("googleAccount")) ?? null;
  } catch {
    return null;
  }
  if (!acc) return null;
  if (acc.refreshToken) {
    try {
      const token = await invoke<{ access_token: string }>("google_refresh_token", {
        refreshToken: acc.refreshToken,
      });
      return token.access_token;
    } catch {
      // refresh failed — fall back to the (possibly stale) stored token
    }
  }
  return acc.accessToken ?? null;
}

export async function getSyncPassword(): Promise<string | null> {
  try {
    return (await invoke<string | null>("secret_get", { id: SYNC_PW_ID })) ?? null;
  } catch {
    return null;
  }
}

export async function setSyncPassword(pw: string): Promise<void> {
  await invoke("secret_set", { id: SYNC_PW_ID, password: pw }).catch(() => {});
}

export async function clearSyncPassword(): Promise<void> {
  await invoke("secret_delete", { id: SYNC_PW_ID }).catch(() => {});
}

/**
 * Startup/login auto-pull. If auto-sync is on, the user is signed in, and the
 * Drive backup is newer than what this device last applied, download + import it
 * and relaunch. Returns true when it triggered a relaunch (caller must stop
 * booting). Designed to run BEFORE React mounts so the store plugin can't write
 * its stale cache back over the freshly imported moorix.json.
 */
export async function maybeAutoPull(
  promptPassword?: () => string | null,
): Promise<boolean> {
  if (!(await autoSyncEnabled())) return false;
  if (sessionStorage.getItem(PULL_GUARD_KEY)) return false;
  const token = await getAccessToken();
  if (!token) return false;

  let remoteTime: string | null;
  try {
    remoteTime = await invoke<string | null>("drive_appdata_modified", {
      accessToken: token,
      name: SYNC_DRIVE_FILE,
    });
  } catch {
    return false; // offline / API error — boot normally
  }
  if (!remoteTime) return false; // nothing backed up yet

  const seen = localStorage.getItem(LAST_REMOTE_KEY);
  if (seen === remoteTime) return false; // already current on this device

  // Remote holds a backup this device hasn't applied → pull it. Guard first so a
  // wrong password or crash mid-pull can't loop the relaunch this session.
  sessionStorage.setItem(PULL_GUARD_KEY, "1");
  let pw = await getSyncPassword();
  if (!pw && promptPassword) pw = promptPassword();
  if (!pw) return false;

  try {
    const data = await invoke<number[]>("drive_download_appdata", {
      accessToken: token,
      name: SYNC_DRIVE_FILE,
    });
    await invoke("import_sync_data", { password: pw, data });
    await setSyncPassword(pw); // remember for unattended sync from now on
    localStorage.setItem(LAST_REMOTE_KEY, remoteTime);
  } catch {
    // wrong password / import failure — boot normally and let the user retry
    return false;
  }
  await relaunch();
  return true;
}

/**
 * Right after an interactive Google sign-in, offer to pull an existing backup
 * for this account — even when auto-sync isn't enabled locally yet (the fresh
 * second device). Confirms and prompts for the password via the callbacks, then
 * imports + relaunches. Returns true if it triggered a relaunch.
 */
export async function pullOnLogin(
  confirmPull: () => boolean,
  promptPassword: () => string | null,
): Promise<boolean> {
  const token = await getAccessToken();
  if (!token) return false;

  let remoteTime: string | null;
  try {
    remoteTime = await invoke<string | null>("drive_appdata_modified", {
      accessToken: token,
      name: SYNC_DRIVE_FILE,
    });
  } catch {
    return false;
  }
  if (!remoteTime) return false; // no backup for this account
  if (localStorage.getItem(LAST_REMOTE_KEY) === remoteTime) return false; // already applied
  if (!confirmPull()) return false;

  let pw = await getSyncPassword();
  if (!pw) pw = promptPassword();
  if (!pw) return false;

  try {
    const data = await invoke<number[]>("drive_download_appdata", {
      accessToken: token,
      name: SYNC_DRIVE_FILE,
    });
    await invoke("import_sync_data", { password: pw, data });
    await setSyncPassword(pw);
    localStorage.setItem(LAST_REMOTE_KEY, remoteTime);
  } catch {
    return false;
  }
  await relaunch();
  return true;
}

/** Upload the current config now. No-op unless auto-sync is on, the user is
 *  signed in, and a sync password is stored. Best-effort; never throws. */
export async function autoPush(): Promise<void> {
  if (!(await autoSyncEnabled())) return;
  const pw = await getSyncPassword();
  if (!pw) return;
  const token = await getAccessToken();
  if (!token) return;
  try {
    const payload = await invoke<number[]>("export_sync_data", { password: pw });
    await invoke<string>("drive_upload_appdata", {
      accessToken: token,
      name: SYNC_DRIVE_FILE,
      data: payload,
    });
    // Record the resulting remote time so this device won't re-pull its own push.
    const t = await invoke<string | null>("drive_appdata_modified", {
      accessToken: token,
      name: SYNC_DRIVE_FILE,
    });
    if (t) localStorage.setItem(LAST_REMOTE_KEY, t);
  } catch {
    // best-effort — a failed push just means the next change retries
  }
}

/** Immediately encrypt + upload the current config with `pw`, bypassing the
 *  enabled flag (which isn't persisted yet right after the user toggles it on).
 *  Records the resulting remote time. Throws on failure so the caller can report. */
export async function seedPush(pw: string): Promise<void> {
  const token = await getAccessToken();
  if (!token) throw new Error("Belum login Google.");
  const payload = await invoke<number[]>("export_sync_data", { password: pw });
  await invoke<string>("drive_upload_appdata", {
    accessToken: token,
    name: SYNC_DRIVE_FILE,
    data: payload,
  });
  const t = await invoke<string | null>("drive_appdata_modified", {
    accessToken: token,
    name: SYNC_DRIVE_FILE,
  });
  if (t) localStorage.setItem(LAST_REMOTE_KEY, t);
}

let pushTimer: ReturnType<typeof setTimeout> | null = null;
/** Debounced auto-push, called after config changes. Coalesces bursts. */
export function scheduleAutoPush(): void {
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    void autoPush();
  }, 4000);
}
