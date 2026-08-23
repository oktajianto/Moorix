import { invoke } from "@tauri-apps/api/core";
import {
  enable as pluginEnable,
  disable as pluginDisable,
  isEnabled as pluginIsEnabled,
} from "@tauri-apps/plugin-autostart";
import { isStoreBuild } from "./appFlavor";

/**
 * Launch-at-login, abstracted over the two backends (Fase 25B-2):
 *   - normal build: the `plugin-autostart` registry Run key
 *   - Microsoft Store (MSIX) build: the packaged `StartupTask` via WinRT
 *     (`startup_task_state` / `startup_task_set` commands), because the registry
 *     Run key is virtualized inside the package and won't actually launch.
 */

export async function isAutostartEnabled(): Promise<boolean> {
  if (await isStoreBuild()) {
    try {
      const s = await invoke<string>("startup_task_state");
      return s === "enabled" || s === "enabledByPolicy";
    } catch {
      return false;
    }
  }
  return pluginIsEnabled();
}

export async function setAutostartEnabled(enabled: boolean): Promise<void> {
  if (await isStoreBuild()) {
    const s = await invoke<string>("startup_task_set", { enabled });
    // Windows can refuse to (re-)enable a StartupTask the user disabled in
    // Settings/Task Manager; the command reports the actual state instead of
    // throwing, so surface it as an error the UI can show.
    if (enabled && s !== "enabled" && s !== "enabledByPolicy") {
      throw new Error(
        "Windows is blocking Moorix from launching at startup. Enable it under Settings → Apps → Startup.",
      );
    }
    return;
  }
  if (enabled) await pluginEnable();
  else await pluginDisable();
}
