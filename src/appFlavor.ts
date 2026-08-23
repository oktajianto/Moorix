import { invoke } from "@tauri-apps/api/core";

/**
 * Whether this is a Microsoft Store (MSIX) build (Fase 25). Store builds have no
 * in-app GitHub updater (the Store delivers updates) and route "Run at startup"
 * to the packaged StartupTask. Cached after the first call; falls back to `false`
 * off-desktop or if the command is unavailable.
 */
let cached: boolean | null = null;

export async function isStoreBuild(): Promise<boolean> {
  if (cached !== null) return cached;
  try {
    cached = await invoke<boolean>("is_store_build");
  } catch {
    cached = false;
  }
  return cached;
}
