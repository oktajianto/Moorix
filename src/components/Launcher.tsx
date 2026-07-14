import { Monitor, Plug } from "lucide-react";
import { invoke, Channel } from "@tauri-apps/api/core";
import type { OpenSession } from "./TerminalView";
import { IS_MOBILE } from "../platform";

type Props = {
  onLaunch: (open: OpenSession, label: string) => void;
  onSshConnection: () => void;
};

/** New-session screen: start a local shell, or open the SSH profile editor. */
export function Launcher({ onLaunch, onSshConnection }: Props) {
  const launchLocal = () => {
    const open: OpenSession = (channel: Channel<number[]>, cols, rows) =>
      invoke<string>("session_open", { onData: channel, cols, rows, shell: null });
    onLaunch(open, "local shell");
  };

  return (
    <div className="flex h-full items-center justify-center p-6">
      <div
        className="w-full max-w-sm rounded-xl border p-6"
        style={{ background: "var(--m-panel)", borderColor: "var(--m-border)" }}
      >
        <h2 className="mb-1 text-center text-2xl font-bold" style={{ color: "var(--m-text)" }}>
          Moorix
        </h2>
        <p className="mb-6 text-center text-xs" style={{ color: "var(--m-muted)" }}>
          New session
        </p>

        <div className="flex flex-col gap-3">
          {!IS_MOBILE && (
            <button
              onClick={launchLocal}
              className="inline-flex items-center justify-center gap-2 rounded-md border px-4 py-3 text-sm font-medium transition hover:border-cyan-500"
              style={{ borderColor: "var(--m-input-border)", color: "var(--m-text)" }}
            >
              <Monitor className="h-4 w-4" /> Local shell
            </button>
          )}
          <button
            onClick={onSshConnection}
            className="inline-flex items-center justify-center gap-2 rounded-md bg-cyan-600 px-4 py-3 text-sm font-medium text-white transition hover:bg-cyan-500"
          >
            <Plug className="h-4 w-4" /> SSH connection
          </button>
        </div>
      </div>
    </div>
  );
}
