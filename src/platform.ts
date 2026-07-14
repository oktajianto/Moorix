import { platform } from "@tauri-apps/plugin-os";

/**
 * Whether we're running on a mobile OS. Mobile is SSH-only — there is no local
 * shell (PTY) and the OS keychain is replaced by an in-memory store. Evaluated
 * once at startup; falls back to desktop outside a Tauri runtime (e.g. tests).
 */
export const IS_MOBILE: boolean = (() => {
  try {
    const p = platform();
    return p === "android" || p === "ios";
  } catch {
    return false;
  }
})();
