import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { platform } from "@tauri-apps/plugin-os";
import type { ToastApi } from "./components/Toast";
import { isStoreBuild } from "./appFlavor";

function isDesktop(): boolean {
  try {
    const p = platform();
    return p !== "android" && p !== "ios";
  } catch {
    return true;
  }
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Check GitHub Releases for a newer version and, if found, silently download +
 * install it (Windows `installMode: "quiet"` — no visible installer), reporting
 * progress through a toast. On success the app relaunches into the new version.
 *
 * @param silent When true (startup auto-check), stay quiet unless an update is
 *   actually found — no "checking" / "up to date" toasts.
 */
export async function checkForUpdates(
  toast: ToastApi,
  opts: { silent?: boolean } = {},
): Promise<void> {
  if (!isDesktop()) return;
  // Microsoft Store builds (Fase 25) get updates via the Store; the in-app
  // GitHub updater plugin isn't registered, so never attempt a check.
  if (await isStoreBuild()) return;

  const checkingId = opts.silent
    ? undefined
    : toast.show({
        title: "Checking for updates…",
        progress: null,
        duration: 0,
      });

  let update: Awaited<ReturnType<typeof check>> = null;
  try {
    update = await check();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (checkingId) {
      toast.update(checkingId, {
        title: "Update check failed",
        message: msg,
        progress: undefined,
        variant: "error",
        duration: 7000,
      });
    }
    return;
  }

  if (!update) {
    if (checkingId) {
      toast.update(checkingId, {
        title: "You're up to date",
        message: "Moorix is running the latest version.",
        progress: undefined,
        variant: "success",
        duration: 4000,
      });
    }
    return;
  }

  // An update is available → download with a progress bar, then install quietly.
  const id =
    checkingId ??
    toast.show({ title: "Update available", progress: null, duration: 0 });
  toast.update(id, {
    title: `Downloading Moorix ${update.version}…`,
    message: undefined,
    progress: null,
    variant: "info",
    duration: 0,
  });

  let total = 0;
  let downloaded = 0;
  try {
    await update.downloadAndInstall((event) => {
      switch (event.event) {
        case "Started":
          total = event.data.contentLength ?? 0;
          downloaded = 0;
          toast.update(id, { progress: total ? 0 : null });
          break;
        case "Progress":
          downloaded += event.data.chunkLength;
          toast.update(id, {
            progress: total ? downloaded / total : null,
            message: total
              ? `${fmtBytes(downloaded)} / ${fmtBytes(total)}`
              : `${fmtBytes(downloaded)} downloaded`,
          });
          break;
        case "Finished":
          toast.update(id, {
            title: `Installing Moorix ${update.version}…`,
            message: "The app will restart automatically.",
            progress: null,
          });
          break;
      }
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    toast.update(id, {
      title: "Update failed",
      message: msg,
      progress: undefined,
      variant: "error",
      duration: 8000,
    });
    return;
  }

  toast.update(id, {
    title: `Updated to Moorix ${update.version}`,
    message: "Restarting…",
    progress: undefined,
    variant: "success",
    duration: 0,
  });

  try {
    await relaunch();
  } catch {
    /* If relaunch is blocked, the update still applies on next manual start. */
  }
}
