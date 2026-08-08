import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow, LogicalPosition } from "@tauri-apps/api/window";
import { Loader2 } from "lucide-react";

/** Logical window size — must match the `backup-banner` window in tauri.conf.json. */
const W = 360;
const H = 88;
const MARGIN = 16;

type Activity = { active: boolean; label: string };

/**
 * Anchor the banner to the bottom-right of the primary monitor's **work area**
 * (`screen.avail*` excludes the taskbar), so it sits just above the OS taskbar
 * like a native notification. Best-effort — position failures are non-fatal.
 */
function reposition(): void {
  try {
    const s = window.screen as Screen & { availLeft?: number; availTop?: number };
    const x = (s.availLeft ?? 0) + s.availWidth - W - MARGIN;
    const y = (s.availTop ?? 0) + s.availHeight - H - MARGIN;
    void getCurrentWindow().setPosition(new LogicalPosition(x, y));
  } catch {
    /* non-fatal */
  }
}

/**
 * The auto-backup progress banner (Fase 23E). Lives in its own frameless,
 * transparent, always-on-top window that the backend shows while any backup runs
 * (see `set_backup_activity`) and hides when idle. It only needs to render the
 * card and keep its text in sync with the `backup-activity` event.
 */
export function BackupBanner() {
  const [label, setLabel] = useState("");

  useEffect(() => {
    reposition();
    const unlisten = listen<Activity>("backup-activity", (e) => {
      if (e.payload.active) {
        setLabel(e.payload.label);
        reposition();
      }
    });
    return () => {
      void unlisten.then((f) => f());
    };
  }, []);

  return (
    <div className="flex h-screen w-screen items-stretch">
      <div
        className="flex-1 overflow-hidden rounded-lg border shadow-xl"
        style={{ background: "var(--m-panel)", borderColor: "var(--m-border)" }}
      >
        <div className="flex items-center gap-3 p-3">
          <Loader2 className="h-5 w-5 shrink-0 animate-spin" style={{ color: "#3b82f6" }} />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium" style={{ color: "var(--m-text)" }}>
              Auto-backup running…
            </div>
            <div className="mt-0.5 truncate text-xs" style={{ color: "var(--m-muted)" }}>
              {label ? `Backing up "${label}"` : "Exporting databases"}
            </div>
          </div>
        </div>
        <div className="h-1 w-full" style={{ background: "var(--m-input)" }}>
          <div
            className="moorix-toast-indeterminate h-full"
            style={{ background: "#3b82f6" }}
          />
        </div>
      </div>
    </div>
  );
}
