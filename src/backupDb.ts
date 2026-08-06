//! Auto-Backup DB (Fase 23) — config model + persistence.
//!
//! A list of backup **jobs** that run automatically on app start (Fase 23C).
//! Each job dumps one/several/all databases of a saved DB profile (child of an
//! SSH profile) into a dated folder under a chosen destination. The whole
//! feature is **off by default** (`enabled`). Persisted in the Tauri store
//! (`moorix.json`, key `dbBackup`) — never localStorage.

import { Channel, invoke } from "@tauri-apps/api/core";
import { getStore, setValue } from "./store";
import { sshOpenFromProfile, type UserProfile } from "./profiles";
import { dbOpen, dbListDatabases, dbClose, type DBProfile } from "./db";
import type { ToastApi } from "./components/Toast";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { isEnabled as isAutostartEnabled } from "@tauri-apps/plugin-autostart";

/* --------------------------- OS notifications ----------------------------- */

let notifyPermGranted: boolean | null = null;

async function ensureNotifyPermission(): Promise<boolean> {
  if (notifyPermGranted !== null) return notifyPermGranted;
  try {
    notifyPermGranted = await isPermissionGranted();
    if (!notifyPermGranted) {
      notifyPermGranted = (await requestPermission()) === "granted";
    }
  } catch {
    notifyPermGranted = false;
  }
  return notifyPermGranted;
}

/**
 * Show a native OS notification (bottom-right near the tray), so backup progress
 * is visible even when the Moorix window is minimized/hidden. Best-effort.
 */
export async function notifyOS(title: string, body: string): Promise<void> {
  try {
    if (await ensureNotifyPermission()) sendNotification({ title, body });
  } catch {
    /* ignore — notifications are best-effort */
  }
}

/* ------------------------ tray activity indicator ------------------------- */
/** Tracks whether any backup (manual or auto) is running and pushes that to the
 *  system tray so its icon tooltip shows "backup sedang berjalan" (bottom-right,
 *  near the Windows clock). Module-global; single window. */

let activeJobs = 0;
let activeLabel = "";

function syncTrayActivity(): void {
  void invoke("set_backup_activity", {
    active: activeJobs > 0,
    label: activeLabel,
  }).catch(() => {});
}

function beginBackupActivity(label: string): void {
  activeJobs += 1;
  activeLabel = label;
  syncTrayActivity();
}

function endBackupActivity(): void {
  activeJobs = Math.max(0, activeJobs - 1);
  if (activeJobs === 0) activeLabel = "";
  syncTrayActivity();
}

/** Per-database outcome from a backup run (mirrors the Rust struct). */
export type BackupFileResult = {
  database: string;
  path: string;
  ok: boolean;
  error: string | null;
  bytes: number;
};

/** Result of one `db_backup_run` (mirrors the Rust struct). */
export type BackupRunResult = {
  folder: string;
  files: BackupFileResult[];
  pruned: string[];
};

/** One auto-backup job. */
export type BackupJob = {
  id: string;
  /** Backup name — human label + marker key for the "already ran today" state. */
  name: string;
  /** Per-job on/off (the master `BackupConfig.enabled` gates the whole feature). */
  enabled: boolean;
  /** SSH profile (`UserProfile.id`) — must be an ssh profile that has DB profiles. */
  sshProfileId: string;
  /** DB profile (`DBProfile.id`, child of the SSH profile) — the userDB account. */
  dbProfileId: string;
  /** When true, back up every database on the server (ignores `databases`). */
  allDatabases: boolean;
  /** Explicit database names to back up (used when `allDatabases` is false). */
  databases: string[];
  /** Destination folder (absolute path), e.g. `C:/backups`. */
  destDir: string;
  /** Base name for the dated folder, e.g. `dbbackup` → `dbbackup-05August2026`. */
  folderBase: string;
  /** Minutes to wait after the previous job finished before this one runs. */
  delayMinutes: number;
  /** Keep the last N days of dated folders; older ones are pruned after a
   *  successful backup. 0 = never prune. */
  retentionDays: number;
};

/** Whole-feature config: master toggle + ordered job list. */
export type BackupConfig = {
  /** Master switch for the entire auto-backup feature. Default false. */
  enabled: boolean;
  jobs: BackupJob[];
};

const KEY = "dbBackup";

export const DEFAULT_BACKUP_CONFIG: BackupConfig = { enabled: false, jobs: [] };

export function createBackupJob(): BackupJob {
  return {
    id: crypto.randomUUID(),
    name: "",
    enabled: true,
    sshProfileId: "",
    dbProfileId: "",
    allDatabases: false,
    databases: [],
    destDir: "",
    folderBase: "dbbackup",
    delayMinutes: 5,
    retentionDays: 2,
  };
}

/** Coerce a possibly-partial stored job into a complete, well-typed one. */
function normalizeJob(j: Partial<BackupJob>): BackupJob {
  const base = createBackupJob();
  return {
    ...base,
    ...j,
    id: j.id || base.id,
    name: j.name ?? "",
    enabled: j.enabled ?? true,
    databases: Array.isArray(j.databases) ? j.databases.filter((s) => typeof s === "string") : [],
    delayMinutes: Number.isFinite(j.delayMinutes as number) ? Number(j.delayMinutes) : 5,
    retentionDays: Number.isFinite(j.retentionDays as number) ? Number(j.retentionDays) : 2,
  };
}

export async function loadBackupConfig(): Promise<BackupConfig> {
  const store = await getStore();
  const v = await store.get<BackupConfig>(KEY);
  if (!v || typeof v !== "object") return { ...DEFAULT_BACKUP_CONFIG };
  return {
    enabled: !!v.enabled,
    jobs: Array.isArray(v.jobs) ? v.jobs.map(normalizeJob) : [],
  };
}

export async function saveBackupConfig(cfg: BackupConfig): Promise<void> {
  await setValue(KEY, cfg);
}

/**
 * Push "tray mode" to the backend (Fase 23D-2): close/minimize hides to the tray
 * instead of quitting when auto-backup OR autostart is enabled. Call on startup
 * and whenever either toggle changes.
 */
export async function syncTrayMode(): Promise<void> {
  try {
    const cfg = await loadBackupConfig();
    let autostart = false;
    try {
      autostart = await isAutostartEnabled();
    } catch {
      /* autostart may be unavailable */
    }
    await invoke("set_tray_mode", { enabled: cfg.enabled || autostart }).catch(() => {});
  } catch {
    /* non-fatal */
  }
}

/* --------------------------- run markers (per day) ------------------------ */

/** `{ [backupName]: "YYYY-MM-DD" }` — the last date each named job ran, so a job
 *  runs at most once per day. Stored in the Tauri store (key `dbBackupRuns`). */
export type RunMarkers = Record<string, string>;

const RUNS_KEY = "dbBackupRuns";

/** Local date as `YYYY-MM-DD` (used as the per-day marker value). */
export function todayKey(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseDateKey(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

export async function loadRunMarkers(): Promise<RunMarkers> {
  const store = await getStore();
  const v = await store.get<RunMarkers>(RUNS_KEY);
  return v && typeof v === "object" ? v : {};
}

export async function saveRunMarkers(m: RunMarkers): Promise<void> {
  await setValue(RUNS_KEY, m);
}

/** Record that job `name` ran today (no-op for empty names). */
export async function markJobRanToday(name: string): Promise<void> {
  const key = name.trim();
  if (!key) return;
  const m = await loadRunMarkers();
  m[key] = todayKey();
  await saveRunMarkers(m);
}

/** Drop markers older than `days` (default 7) so the store can't grow forever
 *  — mainly for jobs that were renamed or deleted. */
export function pruneMarkers(m: RunMarkers, days = 7, now: Date = new Date()): RunMarkers {
  const cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate() - days);
  const out: RunMarkers = {};
  for (const [k, v] of Object.entries(m)) {
    const d = parseDateKey(v);
    if (d && d >= cutoff) out[k] = v;
  }
  return out;
}

const MONTHS_EN = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/**
 * The dated folder name for a job: `<base>-ddMonthNameyyyy` with an English
 * month name (e.g. `dbbackup-05August2026`). Kept in sync with the backend
 * formatter (Fase 23B).
 */
export function datedFolderName(base: string, d: Date = new Date()): string {
  const dd = String(d.getDate()).padStart(2, "0");
  return `${base || "dbbackup"}-${dd}${MONTHS_EN[d.getMonth()]}${d.getFullYear()}`;
}

/**
 * System schemas/databases that are never user data — hidden from the picker and
 * excluded from "all databases" backups. Covers MySQL/MariaDB and PostgreSQL.
 * (The `mysql`/`sys` grant schemas are treated as system too; PostgreSQL's
 * `postgres` default DB is left visible since it can hold real data.)
 */
export const SYSTEM_DATABASES = new Set([
  "information_schema",
  "performance_schema",
  "mysql",
  "sys",
  "template0",
  "template1",
]);

export function isSystemDatabase(name: string): boolean {
  return SYSTEM_DATABASES.has(name.toLowerCase());
}

/** Drop system schemas from a raw database list (case-insensitive). */
export function userDatabases(list: string[]): string[] {
  return list.filter((db) => !isSystemDatabase(db));
}

/**
 * Open a throwaway SSH session for `ssh`, connect the DB profile `db` over it,
 * and return the server's database list — then tear both down. Used by the
 * Backup DB settings UI to populate the database checklist, and reuses the same
 * headless connect the runner needs (Fase 23B/C). Credentials come from the
 * vault/keychain via `sshOpenFromProfile`/`dbOpen`.
 */
export async function fetchDatabaseList(
  ssh: UserProfile,
  db: DBProfile,
): Promise<string[]> {
  // ssh_open needs a data channel + cols/rows; we never read the shell output.
  const channel = new Channel<number[]>();
  const sessionId = await sshOpenFromProfile(ssh)(channel, 80, 24);
  try {
    const dbSessionId = await dbOpen(sessionId, db);
    try {
      return await dbListDatabases(dbSessionId);
    } finally {
      await dbClose(dbSessionId);
    }
  } finally {
    await invoke("session_close", { id: sessionId }).catch(() => {});
  }
}

/**
 * Run one backup job end-to-end: open a throwaway SSH session for the job's SSH
 * profile, connect its DB profile, resolve the database list (explicit or — for
 * `allDatabases` — the server list minus system schemas), then hand off to the
 * `db_backup_run` command (dated folder, one `.sql` per DB, retention prune).
 * Same path the auto-runner (Fase 23C) uses; also driven by the manual button.
 */
export async function runBackupJob(job: BackupJob, ssh: UserProfile): Promise<BackupRunResult> {
  const dbProfile = ssh.databases?.find((d) => d.id === job.dbProfileId);
  if (!dbProfile) throw new Error("User DB not found on this SSH profile");

  beginBackupActivity(job.name.trim() || "(unnamed)");
  try {
    const channel = new Channel<number[]>();
    const sessionId = await sshOpenFromProfile(ssh)(channel, 80, 24);
    try {
      const dbSessionId = await dbOpen(sessionId, dbProfile);
      try {
        const databases = (
          job.allDatabases ? userDatabases(await dbListDatabases(dbSessionId)) : job.databases
        ).filter(Boolean);
        if (databases.length === 0) throw new Error("No databases to back up");

        return await invoke<BackupRunResult>("db_backup_run", {
          dbSessionId,
          databases,
          destDir: job.destDir,
          folderBase: job.folderBase,
          retentionDays: job.retentionDays,
        });
      } finally {
        await dbClose(dbSessionId);
      }
    } finally {
      await invoke("session_close", { id: sessionId }).catch(() => {});
    }
  } finally {
    endBackupActivity();
  }
}

/* ------------------------------ startup runner ---------------------------- */

/** Initial settle delay before the first job (§20.1: "jeda awal 1–2 menit"). */
const INITIAL_DELAY_MS = 90_000;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Guard so the runner fires at most once per app session (survives React
 *  StrictMode double-mount / any re-invocation). */
let autoBackupStarted = false;

/**
 * Auto-backup runner (Fase 23C), fired once on app start. Always prunes stale
 * run markers (>7 days). If the feature is enabled, waits an initial delay, then
 * runs every due job (enabled, named, not yet run today, fully configured)
 * **sequentially** with each job's inter-job delay, showing progress toasts.
 * A job's daily marker is written only on full success (so failures retry next
 * launch). Mode-B vault: the first credential read triggers the unlock modal;
 * cancelling makes the job fail → not marked → retried.
 */
export async function runAutoBackups(userProfiles: UserProfile[], toast: ToastApi): Promise<void> {
  if (autoBackupStarted) return;
  autoBackupStarted = true;

  // Always keep the marker store tidy, even when the feature is off.
  try {
    await saveRunMarkers(pruneMarkers(await loadRunMarkers(), 7));
  } catch {
    /* non-fatal */
  }

  const cfg = await loadBackupConfig().catch(() => null);
  if (!cfg || !cfg.enabled) return;

  const markers = await loadRunMarkers().catch(() => ({} as RunMarkers));
  const today = todayKey();
  const runnable = cfg.jobs
    .filter((j) => j.enabled && j.name.trim() && markers[j.name.trim()] !== today)
    .map((j) => ({ j, ssh: userProfiles.find((p) => p.id === j.sshProfileId) }))
    .filter(
      (x): x is { j: BackupJob; ssh: UserProfile } =>
        !!x.ssh &&
        !!x.j.dbProfileId &&
        !!x.j.destDir.trim() &&
        (x.j.allDatabases || x.j.databases.length > 0),
    );
  if (runnable.length === 0) return;

  await sleep(INITIAL_DELAY_MS);
  toast.show({
    variant: "info",
    title: "Auto-backup starting",
    message: `${runnable.length} job(s) scheduled`,
    duration: 6000,
  });
  void notifyOS("Moorix — Auto-backup", `${runnable.length} job(s) will run…`);

  for (let i = 0; i < runnable.length; i++) {
    const { j, ssh } = runnable[i];
    const label = j.name.trim();
    if (i > 0) await sleep(Math.max(0, j.delayMinutes) * 60_000);

    const id = toast.show({
      variant: "info",
      title: `Backup "${label}" running…`,
      message: "Connecting & exporting databases",
      progress: null,
    });
    try {
      const res = await runBackupJob(j, ssh);
      const failed = res.files.filter((f) => !f.ok);
      if (failed.length === 0) {
        await markJobRanToday(label);
        const prunedNote = res.pruned.length ? ` · ${res.pruned.length} old folders removed` : "";
        toast.update(id, {
          variant: "success",
          title: `Backup "${label}" succeeded — ${res.files.length} databases`,
          message: `${res.folder}${prunedNote}`,
          progress: undefined,
          duration: 6000,
        });
        void notifyOS(`Backup succeeded — ${label}`, `${res.files.length} databases → ${res.folder}${prunedNote}`);
      } else {
        toast.update(id, {
          variant: "error",
          title: `Backup "${label}" — ${failed.length} failed`,
          message: failed.map((f) => `${f.database}: ${f.error}`).join(" · "),
          progress: undefined,
          duration: 8000,
        });
        void notifyOS(`Backup "${label}" — ${failed.length} failed`, failed.map((f) => f.database).join(", "));
      }
    } catch (e) {
      toast.update(id, {
        variant: "error",
        title: `Backup "${label}" failed`,
        message: String(e),
        progress: undefined,
        duration: 8000,
      });
      void notifyOS(`Backup "${label}" failed`, String(e));
    }
  }
}
