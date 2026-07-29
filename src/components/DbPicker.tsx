import { useState } from "react";
import { Database, X, Loader2, Plus, Settings2, Zap } from "lucide-react";
import { paneSessionId } from "./TerminalView";
import { engineLabel, engineSupported, type DBProfile } from "../db";
import type { UserProfile } from "../profiles";

type RowState =
  | { status: "idle" }
  | { status: "busy" }
  | { status: "error"; message: string };

/**
 * Fase 20A-2 database picker. Opened from the pane toolbar (next to SFTP); lists
 * the DB connections saved under the tab's SSH profile and lets you connect with
 * one click (credentials from the vault — no re-typing). Also offers a one-off
 * quick connect and a shortcut to manage connections in the profile editor.
 *
 * For now "connect" validates the connection and shows the server version +
 * database list; 20A-3 turns it into a full database tab with a schema tree.
 */
export function DbPicker({
  paneId,
  profile,
  onClose,
  onConnect,
  onQuickConnect,
  onManage,
}: {
  paneId: string;
  profile: UserProfile | null;
  onClose: () => void;
  /** Open a DB tab for this profile. Resolves on success (picker closes), throws on error. */
  onConnect: (db: DBProfile) => Promise<void>;
  onQuickConnect: () => void;
  onManage: (() => void) | null;
}) {
  const sessionId = paneSessionId(paneId);
  const dbs = profile?.databases ?? [];
  const [rows, setRows] = useState<Record<string, RowState>>({});

  const connect = async (db: DBProfile) => {
    if (!sessionId) {
      setRows((m) => ({ ...m, [db.id]: { status: "error", message: "No active SSH session." } }));
      return;
    }
    setRows((m) => ({ ...m, [db.id]: { status: "busy" } }));
    try {
      await onConnect(db); // opens a DB tab; parent closes the picker on success
    } catch (e) {
      setRows((m) => ({ ...m, [db.id]: { status: "error", message: String(e) } }));
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.5)" }}
      onPointerDown={onClose}
    >
      <div
        className="w-[460px] max-w-[92vw] rounded-lg border shadow-2xl"
        style={{ background: "var(--m-panel)", borderColor: "var(--m-border)", color: "var(--m-text)" }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b px-4 py-3" style={{ borderColor: "var(--m-border)" }}>
          <Database size={16} style={{ color: "var(--m-accent)" }} />
          <span className="text-sm font-semibold">
            Databases{profile?.name ? ` — ${profile.name}` : ""}
          </span>
          <button
            onClick={onClose}
            className="ml-auto grid h-6 w-6 place-items-center rounded"
            style={{ color: "var(--m-muted)" }}
            title="Close"
          >
            <X size={15} />
          </button>
        </div>

        <div className="max-h-[60vh] space-y-1.5 overflow-auto px-4 py-3">
          {!sessionId && (
            <p className="text-xs" style={{ color: "#f0a05a" }}>
              This pane has no connected SSH session yet.
            </p>
          )}

          {!profile && (
            <p className="text-xs" style={{ color: "var(--m-muted)" }}>
              This session isn't a saved profile — save it as an SSH profile to
              keep database connections. You can still quick-connect below.
            </p>
          )}

          {profile && dbs.length === 0 && (
            <p className="text-xs" style={{ color: "var(--m-muted)" }}>
              No database connections saved for this profile yet.
            </p>
          )}

          {dbs.map((db) => {
            const st = rows[db.id] ?? { status: "idle" };
            const supported = engineSupported(db.engine);
            return (
              <div
                key={db.id}
                className="rounded-md border px-3 py-2"
                style={{ borderColor: "var(--m-border)" }}
              >
                <div className="flex items-center gap-2">
                  <Database size={14} style={{ color: "var(--m-accent)" }} />
                  <span className="text-sm font-medium">{db.name}</span>
                  <span
                    className="rounded px-1.5 py-0.5 text-[10px] uppercase"
                    style={{ background: "var(--m-hover)", color: "var(--m-muted)" }}
                  >
                    {engineLabel(db.engine)}
                  </span>
                  <span className="text-xs" style={{ color: "var(--m-muted)" }}>
                    {db.dbUser}@{db.host}:{db.port}
                  </span>
                  <button
                    onClick={() => connect(db)}
                    disabled={!sessionId || !supported || st.status === "busy"}
                    className="ml-auto flex items-center gap-1 rounded px-2 py-1 text-xs font-medium disabled:opacity-50"
                    style={{ background: "var(--m-accent)", color: "var(--m-bg)" }}
                    title={supported ? "Connect" : "PostgreSQL support arrives in 20D"}
                  >
                    {st.status === "busy" && <Loader2 size={13} className="animate-spin" />}
                    {st.status === "busy" ? "Connecting…" : "Connect"}
                  </button>
                </div>

                {!supported && (
                  <p className="mt-1 text-[11px]" style={{ color: "var(--m-muted)" }}>
                    PostgreSQL support arrives in Fase 20D.
                  </p>
                )}

                {st.status === "error" && (
                  <pre
                    className="mt-2 max-h-24 overflow-auto whitespace-pre-wrap rounded border p-2 text-[11px]"
                    style={{ borderColor: "var(--m-border)", color: "#ff6b6b" }}
                  >
                    {st.message}
                  </pre>
                )}
              </div>
            );
          })}
        </div>

        <div
          className="flex flex-wrap gap-2 border-t px-4 py-3"
          style={{ borderColor: "var(--m-border)" }}
        >
          <button
            onClick={onQuickConnect}
            className="flex items-center gap-1.5 rounded border px-3 py-1.5 text-xs"
            style={{ borderColor: "var(--m-input-border)", color: "var(--m-text)" }}
          >
            <Zap size={13} /> Quick connect (one-off)
          </button>
          {onManage && (
            <button
              onClick={onManage}
              className="flex items-center gap-1.5 rounded border px-3 py-1.5 text-xs"
              style={{ borderColor: "var(--m-input-border)", color: "var(--m-text)" }}
            >
              {dbs.length === 0 ? <Plus size={13} /> : <Settings2 size={13} />}
              {dbs.length === 0 ? "Add connection…" : "Manage connections…"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
