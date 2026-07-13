import { useState } from "react";
import { invoke, Channel } from "@tauri-apps/api/core";
import type { OpenSession } from "./TerminalView";

type Props = {
  onLaunch: (open: OpenSession, label: string) => void;
};

/**
 * Session launcher: pick a local shell or fill in SSH connection details.
 * Produces an `OpenSession` closure that `TerminalView` will invoke.
 */
export function Launcher({ onLaunch }: Props) {
  const [mode, setMode] = useState<"menu" | "ssh">("menu");
  const [host, setHost] = useState("");
  const [port, setPort] = useState("22");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const launchLocal = () => {
    const open: OpenSession = (channel: Channel<number[]>, cols, rows) =>
      invoke<string>("session_open", { onData: channel, cols, rows, shell: null });
    onLaunch(open, "local shell");
  };

  const launchSsh = (e: React.FormEvent) => {
    e.preventDefault();
    if (!host.trim() || !username.trim()) {
      setError("Host and username are required.");
      return;
    }
    const config = {
      host: host.trim(),
      port: Number(port) || 22,
      username: username.trim(),
      auth: { type: "password", password },
    };
    const open: OpenSession = (channel: Channel<number[]>, cols, rows) =>
      invoke<string>("ssh_open", { onData: channel, config, cols, rows });
    onLaunch(open, `${config.username}@${config.host}`);
  };

  const inputClass =
    "w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-cyan-500";

  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <h2 className="mb-1 text-center text-2xl font-bold text-neutral-100">Moorix</h2>
        <p className="mb-6 text-center text-xs text-neutral-500">New session</p>

        {mode === "menu" ? (
          <div className="flex flex-col gap-3">
            <button
              onClick={launchLocal}
              className="rounded-md bg-neutral-800 px-4 py-3 text-sm font-medium text-neutral-100 transition hover:bg-neutral-700"
            >
              🖥️ Local shell
            </button>
            <button
              onClick={() => setMode("ssh")}
              className="rounded-md bg-cyan-600 px-4 py-3 text-sm font-medium text-white transition hover:bg-cyan-500"
            >
              🔌 SSH connection
            </button>
          </div>
        ) : (
          <form onSubmit={launchSsh} className="flex flex-col gap-3">
            <div className="flex gap-2">
              <input
                className={inputClass}
                placeholder="Host (e.g. 192.168.1.10)"
                value={host}
                onChange={(e) => setHost(e.target.value)}
                autoFocus
              />
              <input
                className={`${inputClass} w-20 shrink-0`}
                placeholder="Port"
                value={port}
                onChange={(e) => setPort(e.target.value)}
              />
            </div>
            <input
              className={inputClass}
              placeholder="Username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
            <input
              className={inputClass}
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            {error && <p className="text-xs text-red-400">{error}</p>}
            <div className="mt-1 flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setMode("menu");
                  setError(null);
                }}
                className="rounded-md bg-neutral-800 px-4 py-2 text-sm text-neutral-300 transition hover:bg-neutral-700"
              >
                Back
              </button>
              <button
                type="submit"
                className="flex-1 rounded-md bg-cyan-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-cyan-500"
              >
                Connect
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
