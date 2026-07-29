import { useCallback, useEffect, useRef, useState } from "react";
import Editor, { type OnMount } from "@monaco-editor/react";
import {
  Database,
  Table2,
  Eye,
  ChevronRight,
  ChevronDown,
  ChevronLeft,
  RefreshCw,
  Loader2,
  AlertCircle,
  Play,
  Pencil,
  Trash2,
  Plus,
  X,
  Download,
  Upload,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";
import {
  dbListDatabases,
  dbListTables,
  dbRunSql,
  dbBrowse,
  dbSchema,
  dbTableStructure,
  dbUpdateRow,
  dbDeleteRow,
  dbInsertRow,
  dbExportSql,
  dbImportSql,
  dbDropTable,
  dbRenameTable,
  dbDropDatabase,
  dbRenameDatabase,
  PAGE_SIZES,
  type TableInfo,
  type QueryResult,
  type SchemaColumn,
  type TableStructure,
  type ColumnDef,
  type CellValue,
} from "../db";
import { registerSqlCompletion, setSqlSchema } from "../sqlCompletion";

type TablesState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ok"; tables: TableInfo[] };

type Selected = { db: string; table: TableInfo };

/** A request to load a query into the SQL editor and run it (from a table click). */
type SqlRequest = { sql: string; token: number };

/** Backtick-quote a MySQL identifier. */
function quoteIdent(name: string): string {
  return `\`${name.replace(/`/g, "``")}\``;
}

/** Rewrite references to `oldName` → `newName` in a SQL string (handles the
 *  backtick-quoted form and a bareword right after FROM) so a renamed table's
 *  query keeps working. */
function renameTableInSql(sql: string, oldName: string, newName: string): string {
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const quoted = new RegExp("`" + esc(oldName) + "`", "g");
  if (quoted.test(sql)) return sql.replace(new RegExp("`" + esc(oldName) + "`", "g"), quoteIdent(newName));
  const bare = new RegExp("(\\bfrom\\s+)" + esc(oldName) + "\\b", "gi");
  return sql.replace(bare, `$1${quoteIdent(newName)}`);
}

/**
 * Fase 20A-4 database tab. Left: schema tree (database → tables/views). Right: a
 * SQL editor (Monaco) with a paginated result grid, plus a Browse view for the
 * selected table. Clicking a table writes `SELECT * FROM \`table\`` into the
 * editor and runs it (phpMyAdmin-style). Page size is user-selectable.
 */
export function DatabasePanel({
  dbSessionId,
  title,
}: {
  dbSessionId: string;
  title: string;
}) {
  const [databases, setDatabases] = useState<string[] | null>(null);
  const [dbError, setDbError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, TablesState>>({});
  const [selected, setSelected] = useState<Selected | null>(null);
  /** Schema used for the SQL editor (USE <activeDb>) and the Browse view. */
  const [activeDb, setActiveDb] = useState<string | null>(null);
  const [view, setView] = useState<"sql" | "browse" | "structure">("sql");
  const [sqlRequest, setSqlRequest] = useState<SqlRequest | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  // Signals a schema change (drop/rename) to open result grids. `renamedTable`
  // lets the SQL view rewrite its query to the new name instead of erroring.
  const [schemaEvent, setSchemaEvent] = useState<{
    token: number;
    renamedTable?: { db: string; from: string; to: string };
  }>({ token: 0 });
  const fireSchema = (renamedTable?: { db: string; from: string; to: string }) =>
    setSchemaEvent((e) => ({ token: e.token + 1, renamedTable }));
  // Right-click context menu on a tree node.
  const [menu, setMenu] = useState<
    { x: number; y: number; kind: "db" | "table"; db: string; table?: string } | null
  >(null);
  // Rename dialog target.
  const [rename, setRename] = useState<
    { kind: "db" | "table"; db: string; table?: string; current: string } | null
  >(null);

  const loadDatabases = useCallback(() => {
    setDatabases(null);
    setDbError(null);
    dbListDatabases(dbSessionId)
      .then(setDatabases)
      .catch((e) => setDbError(String(e)));
  }, [dbSessionId]);

  useEffect(loadDatabases, [loadDatabases]);

  const toggle = (db: string) => {
    setActiveDb(db);
    if (expanded[db]) {
      setExpanded((m) => {
        const next = { ...m };
        delete next[db];
        return next;
      });
      return;
    }
    setExpanded((m) => ({ ...m, [db]: { status: "loading" } }));
    dbListTables(dbSessionId, db)
      .then((tables) => setExpanded((m) => ({ ...m, [db]: { status: "ok", tables } })))
      .catch((e) =>
        setExpanded((m) => ({ ...m, [db]: { status: "error", message: String(e) } })),
      );
  };

  // Clicking a table: prefill the SQL editor with SELECT * and run it.
  const openTable = (db: string, table: TableInfo) => {
    setSelected({ db, table });
    setActiveDb(db);
    setSqlRequest({ sql: `SELECT * FROM ${quoteIdent(table.name)}`, token: Date.now() });
    setView("sql");
  };

  // Re-fetch a database's table list (after drop/rename).
  const reloadTables = (db: string) => {
    setExpanded((m) => ({ ...m, [db]: { status: "loading" } }));
    dbListTables(dbSessionId, db)
      .then((tables) => setExpanded((m) => ({ ...m, [db]: { status: "ok", tables } })))
      .catch((e) => setExpanded((m) => ({ ...m, [db]: { status: "error", message: String(e) } })));
  };

  const dropTable = async (db: string, table: string) => {
    if (!window.confirm(`DROP TABLE \`${db}\`.\`${table}\`?\n\nThis permanently deletes the table and all its data.`))
      return;
    try {
      await dbDropTable(dbSessionId, db, table);
      if (selected?.db === db && selected?.table.name === table) setSelected(null);
      reloadTables(db);
      fireSchema();
    } catch (e) {
      window.alert(`Drop failed:\n${e}`);
    }
  };

  const dropDatabase = async (db: string) => {
    if (!window.confirm(`DROP DATABASE \`${db}\`?\n\nThis permanently deletes the database and ALL of its tables.`))
      return;
    try {
      await dbDropDatabase(dbSessionId, db);
      setExpanded((m) => {
        const n = { ...m };
        delete n[db];
        return n;
      });
      if (activeDb === db) setActiveDb(null);
      loadDatabases();
      fireSchema();
    } catch (e) {
      window.alert(`Drop failed:\n${e}`);
    }
  };

  const submitRename = async (newName: string) => {
    if (!rename || !newName || newName === rename.current) {
      setRename(null);
      return;
    }
    try {
      if (rename.kind === "table" && rename.table) {
        await dbRenameTable(dbSessionId, rename.db, rename.table, newName);
        if (selected?.db === rename.db && selected?.table.name === rename.table) {
          setSelected((s) => (s ? { ...s, table: { ...s.table, name: newName } } : s));
        }
        reloadTables(rename.db);
      } else {
        await dbRenameDatabase(dbSessionId, rename.db, newName);
        setExpanded((m) => {
          const n = { ...m };
          delete n[rename.db];
          return n;
        });
        if (activeDb === rename.db) setActiveDb(newName);
        loadDatabases();
      }
      fireSchema(
        rename.kind === "table" && rename.table
          ? { db: rename.db, from: rename.table, to: newName }
          : undefined,
      );
      setRename(null);
    } catch (e) {
      window.alert(`Rename failed:\n${e}`);
    }
  };

  return (
    <div className="flex h-full w-full min-h-0" style={{ color: "var(--m-text)" }}>
      {/* Schema tree */}
      <div
        className="flex w-64 shrink-0 flex-col border-r"
        style={{ borderColor: "var(--m-border)", background: "var(--m-panel)" }}
      >
        <div
          className="flex items-center gap-2 border-b px-3 py-2"
          style={{ borderColor: "var(--m-border)" }}
        >
          <Database size={15} style={{ color: "var(--m-accent)" }} />
          <span className="truncate text-sm font-semibold">{title}</span>
          <button
            onClick={loadDatabases}
            className="ml-auto grid h-6 w-6 place-items-center rounded"
            style={{ color: "var(--m-muted)" }}
            title="Refresh"
          >
            <RefreshCw size={13} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto py-1 text-sm">
          {dbError && (
            <div className="flex items-start gap-1.5 px-3 py-2 text-xs" style={{ color: "#ff6b6b" }}>
              <AlertCircle size={13} className="mt-0.5 shrink-0" />
              <span className="break-all">{dbError}</span>
            </div>
          )}
          {!databases && !dbError && (
            <div className="flex items-center gap-2 px-3 py-2 text-xs" style={{ color: "var(--m-muted)" }}>
              <Loader2 size={13} className="animate-spin" /> Loading databases…
            </div>
          )}
          {databases?.map((db) => {
            const state = expanded[db];
            const open = !!state;
            return (
              <div key={db}>
                <button
                  onClick={() => toggle(db)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setMenu({ x: e.clientX, y: e.clientY, kind: "db", db });
                  }}
                  className="flex w-full items-center gap-1 px-2 py-1 text-left hover:bg-[var(--m-hover)]"
                  style={{ background: activeDb === db ? "var(--m-hover)" : undefined }}
                >
                  {open ? (
                    <ChevronDown size={13} style={{ color: "var(--m-muted)" }} />
                  ) : (
                    <ChevronRight size={13} style={{ color: "var(--m-muted)" }} />
                  )}
                  <Database size={13} style={{ color: "var(--m-accent)" }} />
                  <span className="truncate">{db}</span>
                </button>

                {open && (
                  <div className="ml-4 border-l" style={{ borderColor: "var(--m-border)" }}>
                    {state.status === "loading" && (
                      <div className="flex items-center gap-1.5 px-3 py-1 text-xs" style={{ color: "var(--m-muted)" }}>
                        <Loader2 size={12} className="animate-spin" /> Loading…
                      </div>
                    )}
                    {state.status === "error" && (
                      <div className="px-3 py-1 text-xs" style={{ color: "#ff6b6b" }}>
                        {state.message}
                      </div>
                    )}
                    {state.status === "ok" && state.tables.length === 0 && (
                      <div className="px-3 py-1 text-xs" style={{ color: "var(--m-muted)" }}>
                        (no tables)
                      </div>
                    )}
                    {state.status === "ok" &&
                      state.tables.map((t) => {
                        const active = selected?.db === db && selected?.table.name === t.name;
                        return (
                          <button
                            key={t.name}
                            onClick={() => openTable(db, t)}
                            onContextMenu={(e) => {
                              e.preventDefault();
                              setMenu({ x: e.clientX, y: e.clientY, kind: "table", db, table: t.name });
                            }}
                            className="flex w-full items-center gap-1.5 px-2 py-1 pl-3 text-left"
                            style={{ background: active ? "var(--m-hover)" : "transparent" }}
                          >
                            {t.kind === "view" ? (
                              <Eye size={12} style={{ color: "var(--m-muted)" }} />
                            ) : (
                              <Table2 size={12} style={{ color: "var(--m-muted)" }} />
                            )}
                            <span className="truncate">{t.name}</span>
                          </button>
                        );
                      })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Work area */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div
          className="flex items-center gap-1 border-b px-2 py-1.5"
          style={{ borderColor: "var(--m-border)" }}
        >
          <ViewTab active={view === "sql"} onClick={() => setView("sql")}>
            SQL
          </ViewTab>
          <ViewTab
            active={view === "browse"}
            onClick={() => selected && setView("browse")}
            disabled={!selected}
          >
            Browse
          </ViewTab>
          <ViewTab
            active={view === "structure"}
            onClick={() => selected && setView("structure")}
            disabled={!selected}
          >
            Structure
          </ViewTab>
          <span className="ml-2 text-xs" style={{ color: "var(--m-muted)" }}>
            {activeDb ? `schema: ${activeDb}` : "no schema selected"}
          </span>
          {activeDb && (
            <div className="ml-auto flex items-center gap-1.5">
              <button
                onClick={() => setImportOpen(true)}
                className="flex items-center gap-1.5 rounded border px-2 py-1 text-xs"
                style={{ borderColor: "var(--m-border)", color: "var(--m-text)" }}
                title="Import a .sql file"
              >
                <Upload size={13} /> Import
              </button>
              <button
                onClick={() => setExportOpen(true)}
                className="flex items-center gap-1.5 rounded border px-2 py-1 text-xs"
                style={{ borderColor: "var(--m-border)", color: "var(--m-text)" }}
                title="Export to .sql"
              >
                <Download size={13} /> Export
              </button>
            </div>
          )}
        </div>

        {/* SqlView stays mounted (state preserved when toggling to Browse). */}
        <div
          className="min-h-0 flex-1 flex-col"
          style={{ display: view === "sql" ? "flex" : "none" }}
        >
          <SqlView dbSessionId={dbSessionId} activeDb={activeDb} request={sqlRequest} schemaEvent={schemaEvent} />
        </div>
        {view === "browse" && selected && (
          <BrowseView
            key={`${selected.db}.${selected.table.name}`}
            dbSessionId={dbSessionId}
            db={selected.db}
            table={selected.table}
          />
        )}
        {view === "structure" && selected && (
          <StructureView
            key={`${selected.db}.${selected.table.name}`}
            dbSessionId={dbSessionId}
            db={selected.db}
            table={selected.table}
          />
        )}
      </div>

      {exportOpen && activeDb && (
        <ExportDialog
          dbSessionId={dbSessionId}
          database={activeDb}
          table={selected && selected.db === activeDb ? selected.table.name : null}
          onClose={() => setExportOpen(false)}
        />
      )}
      {importOpen && activeDb && (
        <ImportDialog
          dbSessionId={dbSessionId}
          database={activeDb}
          onClose={() => setImportOpen(false)}
          onDone={() => {
            // Refresh the DB list (in case the script created databases) and
            // re-fetch the target database's tables so new ones show at once —
            // reloadTables also expands it if it was collapsed.
            loadDatabases();
            reloadTables(activeDb);
            fireSchema();
          }}
        />
      )}

      {menu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setMenu(null)} onContextMenu={(e) => { e.preventDefault(); setMenu(null); }} />
          <div
            className="fixed z-50 min-w-[160px] overflow-hidden rounded-md border py-1 text-sm shadow-xl"
            style={{ left: menu.x, top: menu.y, background: "var(--m-panel)", borderColor: "var(--m-border)", color: "var(--m-text)" }}
          >
            {menu.kind === "table" ? (
              <>
                <MenuItem onClick={() => { setRename({ kind: "table", db: menu.db, table: menu.table, current: menu.table! }); setMenu(null); }}>
                  Rename table…
                </MenuItem>
                <MenuItem danger onClick={() => { void dropTable(menu.db, menu.table!); setMenu(null); }}>
                  Drop table…
                </MenuItem>
              </>
            ) : (
              <>
                <MenuItem onClick={() => { reloadTables(menu.db); setMenu(null); }}>Refresh tables</MenuItem>
                <MenuItem onClick={() => { setRename({ kind: "db", db: menu.db, current: menu.db }); setMenu(null); }}>
                  Rename database…
                </MenuItem>
                <MenuItem danger onClick={() => { void dropDatabase(menu.db); setMenu(null); }}>
                  Drop database…
                </MenuItem>
              </>
            )}
          </div>
        </>
      )}

      {rename && (
        <RenameDialog
          kind={rename.kind}
          current={rename.current}
          onSubmit={submitRename}
          onCancel={() => setRename(null)}
        />
      )}
    </div>
  );
}

function MenuItem({
  danger,
  onClick,
  children,
}: {
  danger?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className="block w-full px-3 py-1.5 text-left hover:bg-[var(--m-hover)]"
      style={{ color: danger ? "#ef4444" : "var(--m-text)" }}
    >
      {children}
    </button>
  );
}

function RenameDialog({
  kind,
  current,
  onSubmit,
  onCancel,
}: {
  kind: "db" | "table";
  current: string;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(current);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.5)" }} onPointerDown={onCancel}>
      <div
        className="w-[360px] max-w-[92vw] rounded-lg border p-4 shadow-2xl"
        style={{ background: "var(--m-panel)", borderColor: "var(--m-border)", color: "var(--m-text)" }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="mb-2 text-sm font-semibold">Rename {kind === "db" ? "database" : "table"}</div>
        {kind === "db" && (
          <p className="mb-2 text-[11px]" style={{ color: "#f0a05a" }}>
            MySQL has no native rename — tables are moved to a new database and the old one dropped (views/routines not carried over).
          </p>
        )}
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onSubmit(name.trim());
            if (e.key === "Escape") onCancel();
          }}
          className="mb-3 w-full rounded px-2 py-1.5 text-sm"
          style={{ background: "var(--m-input)", border: "1px solid var(--m-border)", color: "var(--m-text)" }}
        />
        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className="rounded border px-3 py-1.5 text-sm" style={{ borderColor: "var(--m-input-border)", color: "var(--m-text)" }}>
            Cancel
          </button>
          <button
            onClick={() => onSubmit(name.trim())}
            disabled={!name.trim() || name.trim() === current}
            className="rounded px-3 py-1.5 text-sm font-medium disabled:opacity-50"
            style={{ background: "var(--m-accent)", color: "var(--m-bg)" }}
          >
            Rename
          </button>
        </div>
      </div>
    </div>
  );
}

function ViewTab({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="rounded px-3 py-1 text-xs font-medium disabled:opacity-40"
      style={{
        background: active ? "var(--m-accent)" : "transparent",
        color: active ? "var(--m-bg)" : "var(--m-text)",
      }}
    >
      {children}
    </button>
  );
}

/* ------------------------------- Export dialog ---------------------------- */

function ExportDialog({
  dbSessionId,
  database,
  table,
  onClose,
}: {
  dbSessionId: string;
  database: string;
  table: string | null;
  onClose: () => void;
}) {
  const [scope, setScope] = useState<"database" | "table">(table ? "table" : "database");
  const [content, setContent] = useState<"all" | "structure" | "data">("all");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      const tables = scope === "table" && table ? [table] : [];
      const path = await dbExportSql(
        dbSessionId,
        database,
        tables,
        content === "structure",
        content === "data",
      );
      setSaved(path);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const radio = (checked: boolean) => (checked ? "var(--m-accent)" : "var(--m-border)");

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.5)" }}
      onPointerDown={onClose}
    >
      <div
        className="w-[440px] max-w-[92vw] rounded-lg border shadow-2xl"
        style={{ background: "var(--m-panel)", borderColor: "var(--m-border)", color: "var(--m-text)" }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b px-4 py-3" style={{ borderColor: "var(--m-border)" }}>
          <Download size={16} style={{ color: "var(--m-accent)" }} />
          <span className="text-sm font-semibold">Export to .sql</span>
          <button onClick={onClose} className="ml-auto grid h-6 w-6 place-items-center rounded" style={{ color: "var(--m-muted)" }} title="Close">
            <X size={15} />
          </button>
        </div>

        <div className="space-y-3 px-4 py-3 text-sm">
          <div>
            <div className="mb-1 text-xs" style={{ color: "var(--m-muted)" }}>Scope</div>
            <label className="mr-4 inline-flex items-center gap-1.5">
              <input type="radio" checked={scope === "database"} onChange={() => setScope("database")} style={{ accentColor: radio(scope === "database") }} />
              Whole database <span className="font-mono">{database}</span>
            </label>
            {table && (
              <label className="inline-flex items-center gap-1.5">
                <input type="radio" checked={scope === "table"} onChange={() => setScope("table")} style={{ accentColor: radio(scope === "table") }} />
                Table <span className="font-mono">{table}</span>
              </label>
            )}
          </div>

          <div>
            <div className="mb-1 text-xs" style={{ color: "var(--m-muted)" }}>Content</div>
            {(["all", "structure", "data"] as const).map((c) => (
              <label key={c} className="mr-4 inline-flex items-center gap-1.5">
                <input type="radio" checked={content === c} onChange={() => setContent(c)} style={{ accentColor: radio(content === c) }} />
                {c === "all" ? "Structure + data" : c === "structure" ? "Structure only" : "Data only"}
              </label>
            ))}
          </div>

          <button
            onClick={run}
            disabled={busy}
            className="flex w-full items-center justify-center gap-2 rounded px-3 py-2 text-sm font-medium disabled:opacity-50"
            style={{ background: "var(--m-accent)", color: "var(--m-bg)" }}
          >
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
            {busy ? "Exporting…" : "Export"}
          </button>

          {error && (
            <pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded border p-2 text-xs" style={{ borderColor: "var(--m-border)", color: "#ff6b6b" }}>
              {error}
            </pre>
          )}
          {saved && (
            <div className="flex items-start gap-2 rounded border p-2 text-xs" style={{ borderColor: "var(--m-border)" }}>
              <CheckCircle2 size={15} className="mt-0.5 shrink-0" style={{ color: "#4ade80" }} />
              <div>
                <div>Saved to Downloads:</div>
                <div className="mt-0.5 break-all font-mono" style={{ color: "var(--m-muted)" }}>{saved}</div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------- Import dialog ---------------------------- */

function ImportDialog({
  dbSessionId,
  database,
  onClose,
  onDone,
}: {
  dbSessionId: string;
  database: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [sql, setSql] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pick = async (file: File) => {
    setError(null);
    setDone(false);
    setFileName(`${file.name} (${(file.size / 1024).toFixed(0)} KB)`);
    setSql(await file.text());
  };

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      await dbImportSql(dbSessionId, database, sql);
      setDone(true);
      onDone();
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
        className="w-[460px] max-w-[92vw] rounded-lg border shadow-2xl"
        style={{ background: "var(--m-panel)", borderColor: "var(--m-border)", color: "var(--m-text)" }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b px-4 py-3" style={{ borderColor: "var(--m-border)" }}>
          <Upload size={16} style={{ color: "var(--m-accent)" }} />
          <span className="text-sm font-semibold">Import .sql</span>
          <button onClick={onClose} className="ml-auto grid h-6 w-6 place-items-center rounded" style={{ color: "var(--m-muted)" }} title="Close">
            <X size={15} />
          </button>
        </div>

        <div className="space-y-3 px-4 py-3 text-sm">
          <div className="text-xs" style={{ color: "var(--m-muted)" }}>
            Runs the script against <span className="font-mono" style={{ color: "var(--m-text)" }}>{database}</span>.
          </div>

          <input
            ref={fileRef}
            type="file"
            accept=".sql,.txt"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void pick(f);
            }}
          />
          <div className="flex items-center gap-2">
            <button
              onClick={() => fileRef.current?.click()}
              className="rounded border px-3 py-1.5 text-xs"
              style={{ borderColor: "var(--m-input-border)", color: "var(--m-text)" }}
            >
              Choose .sql file…
            </button>
            <span className="truncate text-xs" style={{ color: "var(--m-muted)" }}>
              {fileName ?? "no file selected"}
            </span>
          </div>

          <div className="flex items-start gap-2 rounded border p-2 text-[11px]" style={{ borderColor: "var(--m-border)", color: "#f0a05a" }}>
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            <span>The script runs as-is — it may DROP or overwrite existing tables. Make sure you trust it.</span>
          </div>

          <button
            onClick={run}
            disabled={busy || !sql}
            className="flex w-full items-center justify-center gap-2 rounded px-3 py-2 text-sm font-medium disabled:opacity-50"
            style={{ background: "var(--m-accent)", color: "var(--m-bg)" }}
          >
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
            {busy ? "Importing…" : "Import"}
          </button>

          {error && (
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded border p-2 text-xs" style={{ borderColor: "var(--m-border)", color: "#ff6b6b" }}>
              {error}
            </pre>
          )}
          {done && (
            <div className="flex items-center gap-2 rounded border p-2 text-xs" style={{ borderColor: "var(--m-border)" }}>
              <CheckCircle2 size={15} className="shrink-0" style={{ color: "#4ade80" }} />
              Import successful. Refresh the tree to see new tables.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------- SQL editor ------------------------------- */

function SqlView({
  dbSessionId,
  activeDb,
  request,
  schemaEvent,
}: {
  dbSessionId: string;
  activeDb: string | null;
  request: SqlRequest | null;
  /** Schema change (drop/rename). On a table rename, the query is rewritten to
   *  the new name; otherwise the current query is just re-run. */
  schemaEvent: { token: number; renamedTable?: { db: string; from: string; to: string } };
}) {
  const [sql, setSql] = useState("SELECT 1;");
  const [executedSql, setExecutedSql] = useState("");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(100);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [paginated, setPaginated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const activeDbRef = useRef(activeDb);
  activeDbRef.current = activeDb;

  // Autocomplete schema (tables + columns) for the active database, cached.
  const schemaRef = useRef<SchemaColumn[]>([]);
  const schemaCache = useRef<Record<string, SchemaColumn[]>>({});
  useEffect(() => {
    if (!activeDb) return;
    const key = `${dbSessionId}:${activeDb}`;
    const cached = schemaCache.current[key];
    if (cached) {
      schemaRef.current = cached;
      setSqlSchema(cached);
      return;
    }
    let cancelled = false;
    dbSchema(dbSessionId, activeDb)
      .then((cols) => {
        if (cancelled) return;
        schemaCache.current[key] = cols;
        schemaRef.current = cols;
        setSqlSchema(cols);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [dbSessionId, activeDb]);

  // If the executed query is a single-table SELECT, resolve that table's
  // structure so its result grid becomes editable (like Browse). JOINs /
  // expressions / subqueries → null → read-only.
  const [sqlTarget, setSqlTarget] = useState<EditTarget | null>(null);
  useEffect(() => {
    if (!executedSql) {
      setSqlTarget(null);
      return;
    }
    const parsed = parseSingleTable(executedSql);
    const dbName = parsed?.db ?? activeDbRef.current;
    if (!parsed || !dbName) {
      setSqlTarget(null);
      return;
    }
    let cancelled = false;
    dbTableStructure(dbSessionId, dbName, parsed.table)
      .then((s) => {
        if (!cancelled) {
          setSqlTarget({ db: dbName, table: parsed.table, columns: s.columns, primaryKey: s.primaryKey });
        }
      })
      .catch(() => !cancelled && setSqlTarget(null));
    return () => {
      cancelled = true;
    };
  }, [executedSql, dbSessionId]);

  const doRun = useCallback(
    async (text: string, pageArg: number, size: number) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      setBusy(true);
      setError(null);
      try {
        const res = await dbRunSql(dbSessionId, trimmed, activeDbRef.current ?? undefined, pageArg, size);
        setResult(res.result);
        setTotal(res.total);
        setPaginated(res.paginated);
        setExecutedSql(trimmed);
        setPage(pageArg);
      } catch (e) {
        setError(String(e));
        setResult(null);
      } finally {
        setBusy(false);
      }
    },
    [dbSessionId],
  );

  // Ctrl+Enter in Monaco needs the latest run without re-registering.
  const runRef = useRef<() => void>(() => {});
  runRef.current = () => doRun(sql, 0, pageSize);

  // A table click loads a SELECT and runs it.
  useEffect(() => {
    if (!request) return;
    setSql(request.sql);
    doRun(request.sql, 0, pageSize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request?.token]);

  // A schema change elsewhere (drop/rename). On a table rename, rewrite the
  // query to the new name and re-run (so a renamed table keeps showing its
  // data); otherwise just re-run the current query (a dropped table then errors
  // instead of showing stale rows).
  useEffect(() => {
    if (schemaEvent.token === 0) return;
    const r = schemaEvent.renamedTable;
    if (r) {
      const rewritten = renameTableInSql(sql, r.from, r.to);
      if (rewritten !== sql) {
        setSql(rewritten);
        doRun(rewritten, 0, pageSize);
        return;
      }
    }
    if (executedSql) doRun(executedSql, page, pageSize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schemaEvent.token]);

  const onMount: OnMount = (editor, monaco) => {
    registerSqlCompletion(monaco);
    // Point the shared completion provider at this editor's schema on focus.
    setSqlSchema(schemaRef.current);
    editor.onDidFocusEditorText(() => setSqlSchema(schemaRef.current));
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => runRef.current());
  };

  const changePageSize = (n: number) => {
    setPageSize(n);
    if (executedSql) doRun(executedSql, 0, n);
  };

  const isLight = document.documentElement.classList.contains("light");
  const rowsOnPage = result?.rows.length ?? 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b px-2 py-1.5" style={{ borderColor: "var(--m-border)" }}>
        <button
          onClick={() => doRun(sql, 0, pageSize)}
          disabled={busy}
          className="flex items-center gap-1.5 rounded px-3 py-1 text-xs font-medium disabled:opacity-50"
          style={{ background: "var(--m-accent)", color: "var(--m-bg)" }}
        >
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
          Run
        </button>
        <span className="text-[11px]" style={{ color: "var(--m-muted)" }}>
          Ctrl+Enter to run
        </span>
      </div>

      <div className="h-44 shrink-0" style={{ borderBottom: "1px solid var(--m-border)" }}>
        <Editor
          height="100%"
          defaultLanguage="sql"
          theme={isLight ? "light" : "vs-dark"}
          value={sql}
          onChange={(v) => setSql(v ?? "")}
          onMount={onMount}
          options={{
            fontSize: 13,
            minimap: { enabled: false },
            automaticLayout: true,
            scrollBeyondLastLine: false,
          }}
          loading={
            <div className="flex h-full items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin opacity-60" />
            </div>
          }
        />
      </div>

      {paginated && result && (
        <Pager
          page={page}
          pageSize={pageSize}
          total={total}
          rowsOnPage={rowsOnPage}
          busy={busy}
          onPage={(p) => doRun(executedSql, p, pageSize)}
          onPageSize={changePageSize}
        />
      )}

      {error ? (
        <div className="min-h-0 flex-1 overflow-auto">
          <pre className="whitespace-pre-wrap p-3 text-xs" style={{ color: "#ff6b6b" }}>
            {error}
          </pre>
        </div>
      ) : result ? (
        <EditableResult
          dbSessionId={dbSessionId}
          result={result}
          target={sqlTarget}
          onReload={() => doRun(executedSql, page, pageSize)}
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <div className="p-4 text-sm" style={{ color: "var(--m-muted)" }}>
            Run a query to see results.
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------- Browse view ------------------------------ */

/** A table whose result grid can be edited (edit/delete/insert). */
type EditTarget = { db: string; table: string; columns: ColumnDef[]; primaryKey: string[] };

/** Detect a single-table SELECT so its result grid can be made editable. Returns
 *  the table (and optional db) or null for JOINs / expressions / subqueries. */
function parseSingleTable(sql: string): { db?: string; table: string } | null {
  const s = sql.trim().replace(/;+\s*$/, "");
  if (!/^select\s/i.test(s)) return null;
  if (/\bjoin\b/i.test(s)) return null;
  const m = s.match(/\bfrom\s+([^\s,()]+)/i);
  if (!m) return null;
  const afterFrom = s.slice((m.index ?? 0) + m[0].length);
  const clause = afterFrom.search(/\b(where|group|order|limit|having|union|for)\b/i);
  const fromSeg = clause >= 0 ? afterFrom.slice(0, clause) : afterFrom;
  if (fromSeg.includes(",")) return null; // multiple tables
  const parts = m[1].split(".").map((p) => p.replace(/`/g, ""));
  if (parts.length === 2 && parts[1]) return { db: parts[0], table: parts[1] };
  if (parts.length === 1 && parts[0]) return { table: parts[0] };
  return null;
}

/**
 * Result grid + row actions shared by Browse and SQL. When `target` is a table
 * with a primary key present in the result, rows get Edit/Delete and an Insert
 * button appears; otherwise the grid is read-only (e.g. JOIN results).
 */
function EditableResult({
  dbSessionId,
  result,
  target,
  onReload,
}: {
  dbSessionId: string;
  result: QueryResult;
  target: EditTarget | null;
  onReload: () => void;
}) {
  const [editor, setEditor] = useState<
    { mode: "insert" } | { mode: "edit"; row: Record<string, string | null> } | null
  >(null);
  // Checked row indices (into result.rows) for multi-delete. Reset on new data.
  const [selected, setSelected] = useState<Set<number>>(new Set());
  useEffect(() => setSelected(new Set()), [result]);
  // Non-null while a multi-delete runs — drives a blocking loading overlay.
  const [deleting, setDeleting] = useState<{ done: number; total: number } | null>(null);

  const pkPresent =
    !!target &&
    target.primaryKey.length > 0 &&
    target.primaryKey.every((pk) => result.columns.some((c) => c.name === pk));
  const canInsert = !!target && target.columns.length > 0;

  const pkOf = (row: Record<string, string | null>): CellValue[] =>
    (target?.primaryKey ?? []).map((col) => ({ column: col, value: row[col] ?? null }));

  const rowMapAt = (i: number): Record<string, string | null> => {
    const m: Record<string, string | null> = {};
    result.columns.forEach((c, ci) => (m[c.name] = result.rows[i][ci]));
    return m;
  };

  const toggleRow = (i: number) =>
    setSelected((s) => {
      const n = new Set(s);
      n.has(i) ? n.delete(i) : n.add(i);
      return n;
    });
  const toggleAll = () =>
    setSelected((s) =>
      s.size === result.rows.length ? new Set() : new Set(result.rows.map((_, i) => i)),
    );

  const onDelete = async (row: Record<string, string | null>) => {
    if (!target) return;
    if (!window.confirm("Delete this row? This cannot be undone.")) return;
    try {
      await dbDeleteRow(dbSessionId, target.db, target.table, pkOf(row));
      onReload();
    } catch (e) {
      window.alert(`Delete failed:\n${e}`);
    }
  };

  const deleteSelected = async () => {
    if (!target || selected.size === 0) return;
    if (!window.confirm(`Delete ${selected.size} selected row${selected.size === 1 ? "" : "s"}? This cannot be undone.`))
      return;
    const rows = [...selected];
    setDeleting({ done: 0, total: rows.length });
    try {
      let done = 0;
      for (const i of rows) {
        await dbDeleteRow(dbSessionId, target.db, target.table, pkOf(rowMapAt(i)));
        done += 1;
        setDeleting({ done, total: rows.length });
      }
      onReload();
    } catch (e) {
      window.alert(`Delete failed:\n${e}`);
    } finally {
      setDeleting(null);
    }
  };

  const onSubmitEditor = async (cells: CellValue[]) => {
    if (!target) return;
    try {
      if (editor?.mode === "insert") {
        await dbInsertRow(dbSessionId, target.db, target.table, cells);
      } else if (editor?.mode === "edit") {
        await dbUpdateRow(dbSessionId, target.db, target.table, pkOf(editor.row), cells);
      }
      setEditor(null);
      onReload();
    } catch (e) {
      window.alert(`Save failed:\n${e}`);
    }
  };

  return (
    <>
      {canInsert && (
        <div
          className="flex items-center gap-2 border-b px-3 py-1 text-xs"
          style={{ borderColor: "var(--m-border)" }}
        >
          <button
            onClick={() => setEditor({ mode: "insert" })}
            className="flex items-center gap-1 rounded px-2 py-0.5 font-medium"
            style={{ background: "var(--m-accent)", color: "var(--m-bg)" }}
          >
            <Plus size={13} /> Insert row
          </button>
          {pkPresent && selected.size > 0 && (
            <button
              onClick={deleteSelected}
              className="flex items-center gap-1 rounded px-2 py-0.5 font-medium"
              style={{ background: "#ef4444", color: "#fff" }}
            >
              <Trash2 size={13} /> Delete selected ({selected.size})
            </button>
          )}
          {!pkPresent && (
            <span style={{ color: "#f0a05a" }}>no primary key in result — edit/delete disabled</span>
          )}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto">
        <ResultGrid
          result={result}
          selectedRows={pkPresent ? selected : undefined}
          onToggleRow={pkPresent ? toggleRow : undefined}
          onToggleAll={pkPresent ? toggleAll : undefined}
          rowActions={
            pkPresent
              ? (rowMap) => (
                  <div className="flex gap-1">
                    <button onClick={() => setEditor({ mode: "edit", row: rowMap })} title="Edit row">
                      <Pencil size={13} style={{ color: "var(--m-muted)" }} />
                    </button>
                    <button onClick={() => onDelete(rowMap)} title="Delete row">
                      <Trash2 size={13} style={{ color: "#ef4444" }} />
                    </button>
                  </div>
                )
              : undefined
          }
        />
      </div>
      {editor && target && (
        <RowEditor
          mode={editor.mode}
          columns={target.columns}
          primaryKey={target.primaryKey}
          initial={editor.mode === "edit" ? editor.row : null}
          onSubmit={onSubmitEditor}
          onCancel={() => setEditor(null)}
        />
      )}
      {deleting && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center"
          style={{ background: "rgba(0,0,0,0.55)" }}
          // Block all interaction while rows are being deleted.
          onPointerDown={(e) => e.stopPropagation()}
        >
          <div
            className="flex items-center gap-3 rounded-lg border px-5 py-4 shadow-2xl"
            style={{ background: "var(--m-panel)", borderColor: "var(--m-border)", color: "var(--m-text)" }}
          >
            <Loader2 className="h-5 w-5 animate-spin" style={{ color: "var(--m-accent)" }} />
            <span className="text-sm">
              Deleting {deleting.done} of {deleting.total}…
            </span>
          </div>
        </div>
      )}
    </>
  );
}

function BrowseView({
  dbSessionId,
  db,
  table,
}: {
  dbSessionId: string;
  db: string;
  table: TableInfo;
}) {
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(100);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [columns, setColumns] = useState<ColumnDef[] | null>(null);
  const [primaryKey, setPrimaryKey] = useState<string[]>([]);

  // Load structure (columns + PK) once per table for editing.
  useEffect(() => {
    let cancelled = false;
    dbTableStructure(dbSessionId, db, table.name)
      .then((s) => {
        if (cancelled) return;
        setColumns(s.columns);
        setPrimaryKey(s.primaryKey);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [dbSessionId, db, table.name]);

  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    setError(null);
    dbBrowse(dbSessionId, db, table.name, pageSize, page * pageSize)
      .then((r) => {
        if (cancelled) return;
        setResult(r.result);
        setTotal(r.total);
      })
      .catch((e) => !cancelled && setError(String(e)))
      .finally(() => !cancelled && setBusy(false));
    return () => {
      cancelled = true;
    };
  }, [dbSessionId, db, table.name, page, pageSize, reloadToken]);

  const reload = () => setReloadToken((n) => n + 1);
  // Only base tables are editable; views stay read-only.
  const target: EditTarget | null =
    columns && table.kind === "table"
      ? { db, table: table.name, columns, primaryKey }
      : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        className="flex items-center gap-2 border-b px-3 py-1.5 text-xs"
        style={{ borderColor: "var(--m-border)", color: "var(--m-muted)" }}
      >
        {table.kind === "view" ? <Eye size={13} /> : <Table2 size={13} />}
        <span className="font-mono" style={{ color: "var(--m-text)" }}>
          {db}.{table.name}
        </span>
      </div>
      <Pager
        page={page}
        pageSize={pageSize}
        total={total}
        rowsOnPage={result?.rows.length ?? 0}
        busy={busy}
        onPage={setPage}
        onPageSize={(n) => {
          setPageSize(n);
          setPage(0);
        }}
      />

      {error ? (
        <div className="min-h-0 flex-1 overflow-auto">
          <pre className="whitespace-pre-wrap p-3 text-xs" style={{ color: "#ff6b6b" }}>
            {error}
          </pre>
        </div>
      ) : result ? (
        <EditableResult dbSessionId={dbSessionId} result={result} target={target} onReload={reload} />
      ) : (
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin opacity-60" />
        </div>
      )}
    </div>
  );
}

/* ------------------------------- Row editor ------------------------------- */

/** How a column's value should be edited, derived from its SQL type. */
type FieldMeta =
  | { kind: "enum"; options: string[] }
  | { kind: "textarea" }
  | { kind: "text"; maxLen: number }
  | { kind: "int"; min: bigint; max: bigint }
  | { kind: "plain" };

// [signed min, signed max, unsigned max] per integer type.
const INT_RANGE: Record<string, [bigint, bigint, bigint]> = {
  tinyint: [-128n, 127n, 255n],
  smallint: [-32768n, 32767n, 65535n],
  mediumint: [-8388608n, 8388607n, 16777215n],
  int: [-2147483648n, 2147483647n, 4294967295n],
  bigint: [-9223372036854775808n, 9223372036854775807n, 18446744073709551615n],
};

/** Parse an `enum('a','b',…)` type into its options (handles doubled quotes). */
function parseEnumOptions(dataType: string): string[] {
  const m = dataType.match(/^enum\((.*)\)$/i);
  if (!m) return [];
  const inner = m[1];
  const opts: string[] = [];
  let cur = "";
  let inStr = false;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (inStr) {
      if (c === "'" && inner[i + 1] === "'") { cur += "'"; i++; }
      else if (c === "'") inStr = false;
      else cur += c;
    } else if (c === "'") {
      inStr = true;
    } else if (c === ",") {
      opts.push(cur);
      cur = "";
    }
  }
  opts.push(cur);
  return opts;
}

function fieldMeta(dataType: string): FieldMeta {
  const dt = dataType.trim().toLowerCase();
  if (dt.startsWith("enum(")) return { kind: "enum", options: parseEnumOptions(dataType) };
  if (/^(long|medium|tiny)?text$/.test(dt) || dt === "json") return { kind: "textarea" };
  const strM = dt.match(/^(?:var)?char\((\d+)\)/);
  if (strM) return { kind: "text", maxLen: Number(strM[1]) };
  const unsigned = /unsigned/.test(dt);
  const base = dt.replace(/\(.*?\)/, "").replace(/unsigned|zerofill/g, "").trim();
  if (INT_RANGE[base]) {
    const [smin, smax, umax] = INT_RANGE[base];
    return { kind: "int", min: unsigned ? 0n : smin, max: unsigned ? umax : smax };
  }
  return { kind: "plain" };
}

/** Validation message for a value against its column limit, or null if OK. */
function fieldError(meta: FieldMeta, value: string): string | null {
  if (value === "") return null;
  if (meta.kind === "text" && value.length > meta.maxLen) {
    return `Max ${meta.maxLen} chars (now ${value.length})`;
  }
  if (meta.kind === "int") {
    let n: bigint;
    try {
      n = BigInt(value);
    } catch {
      return "Not a valid integer";
    }
    if (n < meta.min || n > meta.max) return `Out of range (${meta.min}…${meta.max})`;
  }
  return null;
}

function RowEditor({
  mode,
  columns,
  primaryKey,
  initial,
  onSubmit,
  onCancel,
}: {
  mode: "insert" | "edit";
  columns: ColumnDef[];
  primaryKey: string[];
  /** Existing row values by column (edit mode); null for insert. */
  initial: Record<string, string | null> | null;
  onSubmit: (cells: CellValue[]) => void | Promise<void>;
  onCancel: () => void;
}) {
  type Field = { value: string; isNull: boolean };
  const [fields, setFields] = useState<Record<string, Field>>(() => {
    const f: Record<string, Field> = {};
    for (const c of columns) {
      const init = initial ? initial[c.name] : undefined;
      f[c.name] = { value: init ?? "", isNull: init === null };
    }
    return f;
  });
  const [busy, setBusy] = useState(false);

  const setField = (name: string, patch: Partial<Field>) =>
    setFields((m) => ({ ...m, [name]: { ...m[name], ...patch } }));

  // Any field over its length / numeric-range limit blocks Save.
  const anyError = columns.some((c) => {
    const f = fields[c.name];
    return !f.isNull && !!fieldError(fieldMeta(c.dataType), f.value);
  });

  const submit = async () => {
    let cells: CellValue[];
    if (mode === "insert") {
      // Include a column only if the user set NULL or typed a value; otherwise
      // omit it so the DB default / auto_increment applies.
      cells = columns
        .filter((c) => fields[c.name].isNull || fields[c.name].value !== "")
        .map((c) => ({ column: c.name, value: fields[c.name].isNull ? null : fields[c.name].value }));
    } else {
      // Edit: send only changed, non-PK columns.
      cells = columns
        .filter((c) => !primaryKey.includes(c.name))
        .filter((c) => {
          const f = fields[c.name];
          const orig = initial?.[c.name] ?? null;
          const now = f.isNull ? null : f.value;
          return now !== orig;
        })
        .map((c) => ({ column: c.name, value: fields[c.name].isNull ? null : fields[c.name].value }));
      if (cells.length === 0) {
        onCancel();
        return;
      }
    }
    setBusy(true);
    await onSubmit(cells);
    setBusy(false);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.5)" }}
      onPointerDown={onCancel}
    >
      <div
        className="flex max-h-[85vh] w-[560px] max-w-[94vw] flex-col rounded-lg border shadow-2xl"
        style={{ background: "var(--m-panel)", borderColor: "var(--m-border)", color: "var(--m-text)" }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b px-4 py-3" style={{ borderColor: "var(--m-border)" }}>
          <span className="text-sm font-semibold">
            {mode === "insert" ? "Insert row" : "Edit row"}
          </span>
          <button onClick={onCancel} className="ml-auto grid h-6 w-6 place-items-center rounded" style={{ color: "var(--m-muted)" }} title="Close">
            <X size={15} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
          {columns.map((c) => {
            const f = fields[c.name];
            const isPk = primaryKey.includes(c.name);
            const readOnly = mode === "edit" && isPk; // don't edit the identifier
            const meta = fieldMeta(c.dataType);
            const err = f.isNull ? null : fieldError(meta, f.value);
            const borderColor = err ? "#ef4444" : "var(--m-border)";
            const baseStyle: React.CSSProperties = {
              background: "var(--m-input)",
              border: `1px solid ${borderColor}`,
              color: "var(--m-text)",
            };
            const disabled = readOnly || f.isNull;
            return (
              <div key={c.name} className="mb-2.5">
                <div className="mb-1 flex items-center gap-2 text-xs">
                  <span className="font-medium">
                    {isPk && <span title="Primary key" style={{ color: "#f0c040" }}>🔑 </span>}
                    {c.name}
                  </span>
                  <span className="max-w-[240px] truncate" title={c.dataType} style={{ color: "var(--m-muted)" }}>
                    {c.dataType}
                  </span>
                  {meta.kind === "text" && !f.isNull && (
                    <span style={{ color: err ? "#ef4444" : "var(--m-muted)" }}>
                      {f.value.length}/{meta.maxLen}
                    </span>
                  )}
                  {c.nullable && (
                    <label className="ml-auto flex items-center gap-1" style={{ color: "var(--m-muted)" }}>
                      <input
                        type="checkbox"
                        checked={f.isNull}
                        disabled={readOnly}
                        onChange={(e) => setField(c.name, { isNull: e.target.checked })}
                      />
                      NULL
                    </label>
                  )}
                </div>

                {meta.kind === "enum" ? (
                  <select
                    value={f.isNull ? "" : f.value}
                    disabled={disabled}
                    onChange={(e) => setField(c.name, { value: e.target.value })}
                    className="w-full rounded px-2 py-1.5 text-sm disabled:opacity-50"
                    style={baseStyle}
                  >
                    {mode === "insert" && !meta.options.includes(f.value) && <option value="">(choose)</option>}
                    {!meta.options.includes(f.value) && f.value !== "" && <option value={f.value}>{f.value}</option>}
                    {meta.options.map((o) => (
                      <option key={o} value={o}>{o}</option>
                    ))}
                  </select>
                ) : meta.kind === "textarea" ? (
                  <textarea
                    value={f.isNull ? "" : f.value}
                    disabled={disabled}
                    rows={3}
                    placeholder={f.isNull ? "NULL" : mode === "insert" && !f.value ? "(default)" : ""}
                    onChange={(e) => setField(c.name, { value: e.target.value })}
                    className="w-full rounded px-2 py-1.5 text-sm disabled:opacity-50"
                    style={{ ...baseStyle, resize: "vertical", minHeight: "2.4rem", fontFamily: "var(--m-mono, monospace)" }}
                  />
                ) : (
                  <input
                    value={f.isNull ? "" : f.value}
                    disabled={disabled}
                    placeholder={f.isNull ? "NULL" : mode === "insert" && !f.value ? "(default)" : ""}
                    onChange={(e) => setField(c.name, { value: e.target.value })}
                    className="w-full rounded px-2 py-1.5 text-sm disabled:opacity-50"
                    style={baseStyle}
                  />
                )}
                {err && (
                  <div className="mt-0.5 text-[11px]" style={{ color: "#ef4444" }}>
                    {err}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="flex justify-end gap-2 border-t px-4 py-3" style={{ borderColor: "var(--m-border)" }}>
          <button
            onClick={onCancel}
            className="rounded border px-4 py-1.5 text-sm"
            style={{ borderColor: "var(--m-input-border)", color: "var(--m-text)" }}
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={busy || anyError}
            title={anyError ? "Fix the highlighted fields first" : undefined}
            className="flex items-center gap-1.5 rounded px-4 py-1.5 text-sm font-medium disabled:opacity-50"
            style={{ background: "var(--m-accent)", color: "var(--m-bg)" }}
          >
            {busy && <Loader2 size={14} className="animate-spin" />}
            {mode === "insert" ? "Insert" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ Structure view ---------------------------- */

function StructureView({
  dbSessionId,
  db,
  table,
}: {
  dbSessionId: string;
  db: string;
  table: TableInfo;
}) {
  const [struct, setStruct] = useState<TableStructure | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setStruct(null);
    setError(null);
    dbTableStructure(dbSessionId, db, table.name)
      .then((s) => !cancelled && setStruct(s))
      .catch((e) => !cancelled && setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [dbSessionId, db, table.name]);

  if (error) {
    return (
      <pre className="whitespace-pre-wrap p-3 text-xs" style={{ color: "#ff6b6b" }}>
        {error}
      </pre>
    );
  }
  if (!struct) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin opacity-60" />
      </div>
    );
  }

  const th = "border-b border-r px-2 py-1 text-left";
  const td = "border-b border-r px-2 py-1";

  return (
    <div className="min-h-0 flex-1 overflow-auto p-3 text-xs" style={{ fontFamily: "var(--m-mono, monospace)" }}>
      <div className="mb-1 flex items-center gap-2 font-sans text-sm">
        {table.kind === "view" ? <Eye size={14} /> : <Table2 size={14} />}
        <span className="font-mono">{db}.{table.name}</span>
        {struct.primaryKey.length === 0 && (
          <span className="rounded px-1.5 py-0.5 text-[10px]" style={{ background: "var(--m-hover)", color: "#f0a05a" }}>
            no primary key
          </span>
        )}
      </div>

      {/* Columns */}
      <table className="mb-4 w-max border-collapse">
        <thead>
          <tr style={{ color: "var(--m-muted)" }}>
            <th className={`${th} text-right`} style={{ borderColor: "var(--m-border)" }}>#</th>
            <th className={th} style={{ borderColor: "var(--m-border)" }}>Column</th>
            <th className={th} style={{ borderColor: "var(--m-border)" }}>Type</th>
            <th className={th} style={{ borderColor: "var(--m-border)" }}>Null</th>
            <th className={th} style={{ borderColor: "var(--m-border)" }}>Key</th>
            <th className={th} style={{ borderColor: "var(--m-border)" }}>Default</th>
            <th className={th} style={{ borderColor: "var(--m-border)" }}>Extra</th>
            <th className={th} style={{ borderColor: "var(--m-border)" }}>Comment</th>
          </tr>
        </thead>
        <tbody>
          {struct.columns.map((c, ci) => (
            <tr key={c.name} className="hover:bg-[var(--m-hover)]">
              <td className={`${td} text-right`} style={{ borderColor: "var(--m-border)", color: "var(--m-muted)" }}>
                {ci + 1}
              </td>
              <td className={`${td} font-medium`} style={{ borderColor: "var(--m-border)" }}>
                {c.key === "PRI" && <span title="Primary key" style={{ color: "#f0c040" }}>🔑 </span>}
                {c.name}
              </td>
              <td
                className={`${td} max-w-[220px] truncate`}
                style={{ borderColor: "var(--m-border)", color: "var(--m-muted)" }}
                title={c.dataType}
              >
                {c.dataType}
              </td>
              <td className={td} style={{ borderColor: "var(--m-border)" }}>{c.nullable ? "YES" : "NO"}</td>
              <td className={td} style={{ borderColor: "var(--m-border)" }}>{c.key}</td>
              <td className={td} style={{ borderColor: "var(--m-border)", color: "var(--m-muted)" }}>
                {c.default === null ? <span className="italic opacity-70">NULL</span> : c.default}
              </td>
              <td className={td} style={{ borderColor: "var(--m-border)", color: "var(--m-muted)" }}>{c.extra}</td>
              <td className={td} style={{ borderColor: "var(--m-border)", color: "var(--m-muted)" }}>{c.comment}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Indexes */}
      <div className="mb-1 font-sans font-semibold" style={{ color: "var(--m-text)" }}>Indexes</div>
      {struct.indexes.length === 0 ? (
        <div className="mb-4" style={{ color: "var(--m-muted)" }}>(none)</div>
      ) : (
        <table className="mb-4 w-max border-collapse">
          <thead>
            <tr style={{ color: "var(--m-muted)" }}>
              <th className={`${th} text-right`} style={{ borderColor: "var(--m-border)" }}>#</th>
              <th className={th} style={{ borderColor: "var(--m-border)" }}>Name</th>
              <th className={th} style={{ borderColor: "var(--m-border)" }}>Unique</th>
              <th className={th} style={{ borderColor: "var(--m-border)" }}>Columns</th>
            </tr>
          </thead>
          <tbody>
            {struct.indexes.map((i, ii) => (
              <tr key={i.name}>
                <td className={`${td} text-right`} style={{ borderColor: "var(--m-border)", color: "var(--m-muted)" }}>
                  {ii + 1}
                </td>
                <td className={td} style={{ borderColor: "var(--m-border)" }}>{i.name}</td>
                <td className={td} style={{ borderColor: "var(--m-border)" }}>{i.unique ? "YES" : "NO"}</td>
                <td className={td} style={{ borderColor: "var(--m-border)", color: "var(--m-muted)" }}>{i.columns.join(", ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Foreign keys */}
      <div className="mb-1 font-sans font-semibold" style={{ color: "var(--m-text)" }}>Foreign keys</div>
      {struct.foreignKeys.length === 0 ? (
        <div style={{ color: "var(--m-muted)" }}>(none)</div>
      ) : (
        <table className="w-max border-collapse">
          <thead>
            <tr style={{ color: "var(--m-muted)" }}>
              <th className={th} style={{ borderColor: "var(--m-border)" }}>Name</th>
              <th className={th} style={{ borderColor: "var(--m-border)" }}>Column</th>
              <th className={th} style={{ borderColor: "var(--m-border)" }}>References</th>
            </tr>
          </thead>
          <tbody>
            {struct.foreignKeys.map((f) => (
              <tr key={f.name + f.column}>
                <td className={td} style={{ borderColor: "var(--m-border)" }}>{f.name}</td>
                <td className={td} style={{ borderColor: "var(--m-border)" }}>{f.column}</td>
                <td className={td} style={{ borderColor: "var(--m-border)", color: "var(--m-muted)" }}>
                  {f.refTable}.{f.refColumn}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/* -------------------------------- Pager ----------------------------------- */

function Pager({
  page,
  pageSize,
  total,
  rowsOnPage,
  busy,
  onPage,
  onPageSize,
}: {
  page: number;
  pageSize: number;
  /** Exact total, or null when unknown (SQL results whose count failed). */
  total: number | null;
  rowsOnPage: number;
  busy: boolean;
  onPage: (page: number) => void;
  onPageSize: (size: number) => void;
}) {
  const pages = total != null ? Math.max(1, Math.ceil(total / pageSize)) : null;
  const from = rowsOnPage === 0 ? 0 : page * pageSize + 1;
  const to = page * pageSize + rowsOnPage;
  const canPrev = page > 0;
  const canNext = pages != null ? page + 1 < pages : rowsOnPage === pageSize;

  return (
    <div
      className="flex items-center gap-2 border-b px-3 py-1 text-xs"
      style={{ borderColor: "var(--m-border)", color: "var(--m-muted)" }}
    >
      <span>Rows per page:</span>
      <select
        value={pageSize}
        onChange={(e) => onPageSize(Number(e.target.value))}
        className="rounded px-1 py-0.5"
        style={{ background: "var(--m-input)", border: "1px solid var(--m-border)", color: "var(--m-text)" }}
      >
        {PAGE_SIZES.map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>

      <div className="ml-auto flex items-center gap-2">
        {busy && <Loader2 size={13} className="animate-spin" />}
        <span>
          {from}–{to}
          {total != null ? ` of ${total}` : ""}
        </span>
        <button
          onClick={() => onPage(page - 1)}
          disabled={!canPrev || busy}
          className="grid h-6 w-6 place-items-center rounded disabled:opacity-30"
          style={{ border: "1px solid var(--m-border)" }}
          title="Previous page"
        >
          <ChevronLeft size={14} />
        </button>
        <span>
          {page + 1}
          {pages != null ? `/${pages}` : ""}
        </span>
        <button
          onClick={() => onPage(page + 1)}
          disabled={!canNext || busy}
          className="grid h-6 w-6 place-items-center rounded disabled:opacity-30"
          style={{ border: "1px solid var(--m-border)" }}
          title="Next page"
        >
          <ChevronRight size={14} />
        </button>
      </div>
    </div>
  );
}

/* ------------------------------- Result grid ------------------------------ */

function ResultGrid({
  result,
  rowActions,
  selectedRows,
  onToggleRow,
  onToggleAll,
}: {
  result: QueryResult;
  /** Optional per-row action buttons (edit/delete). `row` maps column name → cell. */
  rowActions?: (row: Record<string, string | null>) => React.ReactNode;
  /** When provided, a checkbox column is shown for multi-row selection. */
  selectedRows?: Set<number>;
  onToggleRow?: (index: number) => void;
  onToggleAll?: () => void;
}) {
  const selectable = !!selectedRows && !!onToggleRow;
  const allChecked = selectable && result.rows.length > 0 && selectedRows!.size === result.rows.length;
  if (result.columns.length === 0) {
    return (
      <div className="p-4 text-sm" style={{ color: "var(--m-muted)" }}>
        OK — {result.rowsAffected} row{result.rowsAffected === 1 ? "" : "s"} affected.
      </div>
    );
  }
  const rowMapOf = (row: (string | null)[]): Record<string, string | null> => {
    const m: Record<string, string | null> = {};
    result.columns.forEach((c, i) => (m[c.name] = row[i]));
    return m;
  };
  return (
    <div className="min-w-full">
      {result.truncated && (
        <div
          className="border-b px-3 py-1 text-[11px]"
          style={{ borderColor: "var(--m-border)", color: "#f0a05a" }}
        >
          Showing first {result.rows.length} rows (result truncated).
        </div>
      )}
      <table className="w-max border-collapse text-xs" style={{ fontFamily: "var(--m-mono, monospace)" }}>
        <thead>
          <tr>
            {selectable && (
              <th
                className="sticky top-0 border-b border-r px-2 py-1 text-center"
                style={{ background: "var(--m-panel)", borderColor: "var(--m-border)" }}
              >
                <input type="checkbox" checked={allChecked} onChange={onToggleAll} title="Select all" />
              </th>
            )}
            {rowActions && (
              <th
                className="sticky top-0 border-b border-r px-2 py-1"
                style={{ background: "var(--m-panel)", borderColor: "var(--m-border)" }}
              />
            )}
            <th
              className="sticky top-0 border-b border-r px-2 py-1 text-right"
              style={{ background: "var(--m-panel)", borderColor: "var(--m-border)", color: "var(--m-muted)" }}
            >
              #
            </th>
            {result.columns.map((c) => (
              <th
                key={c.name}
                className="sticky top-0 border-b border-r px-2 py-1 text-left"
                style={{ background: "var(--m-panel)", borderColor: "var(--m-border)" }}
              >
                <div style={{ color: "var(--m-text)" }}>{c.name}</div>
                <div className="text-[10px] font-normal" style={{ color: "var(--m-muted)" }}>
                  {c.dbType}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {result.rows.map((row, ri) => (
            <tr
              key={ri}
              className="hover:bg-[var(--m-hover)]"
              style={selectable && selectedRows!.has(ri) ? { background: "var(--m-hover)" } : undefined}
            >
              {selectable && (
                <td
                  className="border-b border-r px-2 py-1 text-center"
                  style={{ borderColor: "var(--m-border)" }}
                >
                  <input type="checkbox" checked={selectedRows!.has(ri)} onChange={() => onToggleRow!(ri)} />
                </td>
              )}
              {rowActions && (
                <td
                  className="border-b border-r px-2 py-1"
                  style={{ borderColor: "var(--m-border)" }}
                >
                  {rowActions(rowMapOf(row))}
                </td>
              )}
              <td
                className="border-b border-r px-2 py-1 text-right"
                style={{ borderColor: "var(--m-border)", color: "var(--m-muted)" }}
              >
                {ri + 1}
              </td>
              {row.map((cell, ci) => (
                <td
                  key={ci}
                  className="max-w-[360px] truncate border-b border-r px-2 py-1"
                  style={{ borderColor: "var(--m-border)" }}
                  title={cell ?? "NULL"}
                >
                  {cell === null ? (
                    <span className="italic" style={{ color: "var(--m-muted)", opacity: 0.7 }}>
                      NULL
                    </span>
                  ) : cell === "" ? (
                    <span style={{ color: "var(--m-muted)", opacity: 0.5 }}>∅</span>
                  ) : (
                    cell
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
