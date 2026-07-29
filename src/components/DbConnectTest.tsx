import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Database, X, Loader2 } from "lucide-react";
import { paneSessionId } from "./TerminalView";

/** Result payload of the `db_test_connect` command (Fase 20A-1 spike). */
type DbTestResult = { version: string; databases: string[] };

/**
 * Fase 20A-1 connectivity spike UI. A throwaway dialog that proves the DB
 * tunnel path end to end: it opens a MySQL/MariaDB connection through the
 * pane's SSH session and shows the server version + database list. This gets
 * replaced by real DB profiles + a picker in 20A-2.
 */
export function DbConnectTest({
  paneId,
  onClose,
}: {
  paneId: string;
  onClose: () => void;
}) {
  const sessionId = paneSessionId(paneId);
  const [host, setHost] = useState("127.0.0.1");
  const [port, setPort] = useState("3306");
  const [user, setUser] = useState("root");
  const [password, setPassword] = useState("");
  const [database, setDatabase] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DbTestResult | null>(null);

  const run = async () => {
    if (!sessionId) {
      setError("No active SSH session on this pane.");
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await invoke<DbTestResult>("db_test_connect", {
        sessionId,
        host: host.trim() || "127.0.0.1",
        port: Number(port) || 3306,
        user,
        password,
        database: database.trim() || null,
      });
      setResult(res);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.5)" }}
      onPointerDown={onClose}
    >
      <div
        className="w-[440px] max-w-[92vw] rounded-lg border shadow-2xl"
        style={{
          background: "var(--m-panel)",
          borderColor: "var(--m-border)",
          color: "var(--m-text)",
        }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-center gap-2 border-b px-4 py-3"
          style={{ borderColor: "var(--m-border)" }}
        >
          <Database size={16} style={{ color: "var(--m-accent)" }} />
          <span className="text-sm font-semibold">Database — test connect (20A-1)</span>
          <button
            onClick={onClose}
            className="ml-auto grid h-6 w-6 place-items-center rounded"
            style={{ color: "var(--m-muted)" }}
            title="Close"
          >
            <X size={15} />
          </button>
        </div>

        <div className="space-y-2.5 px-4 py-3">
          {!sessionId && (
            <p className="text-xs" style={{ color: "#f0a05a" }}>
              This pane has no connected SSH session yet.
            </p>
          )}
          <div className="flex gap-2">
            <Field label="Host (from server)" className="flex-1">
              <input value={host} onChange={(e) => setHost(e.target.value)} style={inputStyle} />
            </Field>
            <Field label="Port" className="w-24">
              <input value={port} onChange={(e) => setPort(e.target.value)} style={inputStyle} />
            </Field>
          </div>
          <div className="flex gap-2">
            <Field label="User" className="flex-1">
              <input value={user} onChange={(e) => setUser(e.target.value)} style={inputStyle} />
            </Field>
            <Field label="Password" className="flex-1">
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                style={inputStyle}
              />
            </Field>
          </div>
          <Field label="Database (optional)">
            <input value={database} onChange={(e) => setDatabase(e.target.value)} style={inputStyle} />
          </Field>

          <button
            onClick={run}
            disabled={busy || !sessionId}
            className="mt-1 flex w-full items-center justify-center gap-2 rounded px-3 py-2 text-sm font-medium disabled:opacity-50"
            style={{ background: "var(--m-accent)", color: "var(--m-bg)" }}
          >
            {busy && <Loader2 size={15} className="animate-spin" />}
            {busy ? "Connecting…" : "Test connect"}
          </button>

          {error && (
            <pre
              className="max-h-32 overflow-auto whitespace-pre-wrap rounded border p-2 text-xs"
              style={{ borderColor: "var(--m-border)", color: "#ff6b6b" }}
            >
              {error}
            </pre>
          )}

          {result && (
            <div
              className="rounded border p-2 text-xs"
              style={{ borderColor: "var(--m-border)" }}
            >
              <div className="mb-1">
                <span style={{ color: "var(--m-muted)" }}>Server version: </span>
                <span className="font-mono">{result.version || "(unknown)"}</span>
              </div>
              <div style={{ color: "var(--m-muted)" }}>
                Databases ({result.databases.length}):
              </div>
              <div className="mt-1 flex flex-wrap gap-1">
                {result.databases.map((d) => (
                  <span
                    key={d}
                    className="rounded px-1.5 py-0.5 font-mono"
                    style={{ background: "var(--m-bg)", border: "1px solid var(--m-border)" }}
                  >
                    {d}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  background: "var(--m-bg)",
  border: "1px solid var(--m-border)",
  borderRadius: 4,
  padding: "5px 8px",
  fontSize: 13,
  color: "var(--m-text)",
  outline: "none",
};

function Field({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={className}>
      <div className="mb-1 text-xs" style={{ color: "var(--m-muted)" }}>
        {label}
      </div>
      {children}
    </label>
  );
}
