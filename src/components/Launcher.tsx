import { useEffect, useState } from "react";
import { Monitor, Plug, Cpu, Network, ArrowLeft } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import type { OpenSession, TermOptions } from "./TerminalView";
import { localOpen, serialOpen, telnetOpen } from "../profiles";
import { IS_MOBILE } from "../platform";

type Props = {
  onLaunch: (open: OpenSession, label: string, options?: TermOptions) => void;
  onSshConnection: () => void;
};

const BAUD_RATES = [9600, 19200, 38400, 57600, 115200, 230400];

/** New-session screen: local shell, SSH, serial (desktop), or Telnet. */
export function Launcher({ onLaunch, onSshConnection }: Props) {
  const [mode, setMode] = useState<"menu" | "serial" | "telnet">("menu");

  const launchLocal = () => onLaunch(localOpen(""), "local shell");

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

        {mode === "menu" && (
          <div className="flex flex-col gap-3">
            {!IS_MOBILE && (
              <MenuButton onClick={launchLocal} outline>
                <Monitor className="h-4 w-4" /> Local shell
              </MenuButton>
            )}
            <button
              onClick={onSshConnection}
              className="inline-flex items-center justify-center gap-2 rounded-md bg-cyan-600 px-4 py-3 text-sm font-medium text-white transition hover:bg-cyan-500"
            >
              <Plug className="h-4 w-4" /> SSH connection
            </button>
            {!IS_MOBILE && (
              <MenuButton onClick={() => setMode("serial")} outline>
                <Cpu className="h-4 w-4" /> Serial connection
              </MenuButton>
            )}
            <MenuButton onClick={() => setMode("telnet")} outline>
              <Network className="h-4 w-4" /> Telnet
            </MenuButton>
          </div>
        )}

        {mode === "serial" && (
          <SerialForm
            onBack={() => setMode("menu")}
            onConnect={(path, baud) => onLaunch(serialOpen(path, baud), `serial ${path}`)}
          />
        )}

        {mode === "telnet" && (
          <TelnetForm
            onBack={() => setMode("menu")}
            onConnect={(host, port) => onLaunch(telnetOpen(host, port), `${host}:${port}`)}
          />
        )}
      </div>
    </div>
  );
}

function MenuButton({
  onClick,
  outline,
  children,
}: {
  onClick: () => void;
  outline?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center justify-center gap-2 rounded-md border px-4 py-3 text-sm font-medium transition hover:border-cyan-500"
      style={outline ? { borderColor: "var(--m-input-border)", color: "var(--m-text)" } : undefined}
    >
      {children}
    </button>
  );
}

const inputStyle = {
  background: "var(--m-input)",
  borderColor: "var(--m-input-border)",
  color: "var(--m-text)",
} as const;

function SerialForm({
  onBack,
  onConnect,
}: {
  onBack: () => void;
  onConnect: (path: string, baud: number) => void;
}) {
  const [ports, setPorts] = useState<string[]>([]);
  const [path, setPath] = useState("");
  const [baud, setBaud] = useState(115200);

  useEffect(() => {
    void invoke<string[]>("serial_ports")
      .then((list) => {
        const arr = Array.isArray(list) ? list : [];
        setPorts(arr);
        if (arr.length > 0) setPath((p) => p || arr[0]);
      })
      .catch(() => {});
  }, []);

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (path.trim()) onConnect(path.trim(), baud);
      }}
    >
      <FormHeader onBack={onBack} title="Serial connection" />
      <label className="text-xs" style={{ color: "var(--m-muted)" }}>Port</label>
      {ports.length > 0 ? (
        <select
          value={path}
          onChange={(e) => setPath(e.target.value)}
          className="rounded-md border px-3 py-2 text-sm outline-none focus:border-cyan-500"
          style={inputStyle}
        >
          {ports.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
      ) : (
        <input
          value={path}
          onChange={(e) => setPath(e.target.value)}
          placeholder="e.g. COM3 or /dev/ttyUSB0"
          className="rounded-md border px-3 py-2 text-sm outline-none focus:border-cyan-500"
          style={inputStyle}
        />
      )}
      <label className="text-xs" style={{ color: "var(--m-muted)" }}>Baud rate</label>
      <select
        value={baud}
        onChange={(e) => setBaud(Number(e.target.value))}
        className="rounded-md border px-3 py-2 text-sm outline-none focus:border-cyan-500"
        style={inputStyle}
      >
        {BAUD_RATES.map((b) => (
          <option key={b} value={b}>{b}</option>
        ))}
      </select>
      <ConnectButton disabled={!path.trim()} />
    </form>
  );
}

function TelnetForm({
  onBack,
  onConnect,
}: {
  onBack: () => void;
  onConnect: (host: string, port: number) => void;
}) {
  const [host, setHost] = useState("");
  const [port, setPort] = useState(23);

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (host.trim()) onConnect(host.trim(), port);
      }}
    >
      <FormHeader onBack={onBack} title="Telnet" />
      <label className="text-xs" style={{ color: "var(--m-muted)" }}>Host</label>
      <input
        autoFocus
        value={host}
        onChange={(e) => setHost(e.target.value)}
        placeholder="hostname or IP"
        className="rounded-md border px-3 py-2 text-sm outline-none focus:border-cyan-500"
        style={inputStyle}
      />
      <label className="text-xs" style={{ color: "var(--m-muted)" }}>Port</label>
      <input
        type="number"
        value={port}
        onChange={(e) => setPort(Number(e.target.value) || 23)}
        className="rounded-md border px-3 py-2 text-sm outline-none focus:border-cyan-500"
        style={inputStyle}
      />
      <ConnectButton disabled={!host.trim()} />
    </form>
  );
}

function FormHeader({ onBack, title }: { onBack: () => void; title: string }) {
  return (
    <div className="mb-1 flex items-center gap-2">
      <button
        type="button"
        onClick={onBack}
        className="grid h-7 w-7 place-items-center rounded transition hover:bg-white/10"
        style={{ color: "var(--m-muted)" }}
        title="Back"
      >
        <ArrowLeft className="h-4 w-4" />
      </button>
      <span className="text-sm font-semibold" style={{ color: "var(--m-text)" }}>{title}</span>
    </div>
  );
}

function ConnectButton({ disabled }: { disabled: boolean }) {
  return (
    <button
      type="submit"
      disabled={disabled}
      className="mt-1 inline-flex items-center justify-center gap-2 rounded-md bg-cyan-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-40"
    >
      Connect
    </button>
  );
}
