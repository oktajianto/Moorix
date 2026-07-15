import { useCallback, useEffect, useRef, useState } from "react";
import { invoke, Channel } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import {
  Folder,
  File as FileIcon,
  FileImage,
  FileVideo,
  FileAudio,
  FileArchive,
  FileCode,
  FileText,
  ArrowUp,
  ArrowDownToLine,
  ArrowUpToLine,
  RefreshCw,
  X,
  Ban,
  HardDrive,
  Server,
  Loader2,
} from "lucide-react";

/** Pick an icon by file extension. */
const iconForFile = (name: string): typeof FileIcon => {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico", "avif"].includes(ext)) return FileImage;
  if (["mp4", "mkv", "avi", "mov", "webm", "flv"].includes(ext)) return FileVideo;
  if (["mp3", "wav", "flac", "ogg", "m4a", "aac"].includes(ext)) return FileAudio;
  if (["zip", "tar", "gz", "tgz", "rar", "7z", "bz2", "xz"].includes(ext)) return FileArchive;
  if (["js","ts","tsx","jsx","py","rs","go","c","cpp","h","hpp","java","rb","php","sh","json","yml","yaml","toml","html","css","xml","sql","vue"].includes(ext)) return FileCode;
  if (["txt", "md", "log", "conf", "cfg", "ini", "env", "csv"].includes(ext)) return FileText;
  return FileIcon;
};

type XferDir = "up" | "down"; // up = upload (local→remote), down = download

type Xfer = {
  id: string;
  file: string;
  transferred: number;
  total: number;
  dir: XferDir;
  index?: number;
  count?: number;
};

/** A queued transfer with its resolved source + destination directories. */
type Job = {
  dir: XferDir;
  srcPath: string;
  remoteDir: string;
  localDir: string;
};

type XferEvent =
  | { kind: "started"; total: number; files: number }
  | { kind: "file"; index: number; count: number; name: string }
  | { kind: "progress"; transferred: number; total: number; file: string }
  | { kind: "done" }
  | { kind: "cancelled" }
  | { kind: "error"; message: string };

/** One directory entry (shared shape for local + remote). */
type Entry = { name: string; isDir: boolean; size: number; mtime: number };

const joinPath = (base: string, name: string): string => {
  const b = base.replace(/\/+$/, "");
  return b === "" ? `/${name}` : `${b}/${name}`;
};

const baseName = (p: string): string =>
  p.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || p;

const parentPath = (p: string): string => {
  const t = p.replace(/\/+$/, "");
  const i = t.lastIndexOf("/");
  if (i < 0) return t; // e.g. Windows drive "C:" — stay put
  return i === 0 ? "/" : t.slice(0, i);
};

const sortEntries = (a: Entry[]): Entry[] =>
  [...a].sort((x, y) =>
    x.isDir !== y.isDir ? (x.isDir ? -1 : 1) : x.name.localeCompare(y.name),
  );

const fmtSize = (n: number): string => {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`;
};

/**
 * SFTP file manager panel: local filesystem (top) and the remote VPS (bottom),
 * both browsable. Transfers and remote operations arrive in later stages.
 */
export function SftpPanel({
  sessionId,
  onClose,
}: {
  sessionId: string;
  onClose: () => void;
}) {
  const [sftpId, setSftpId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const [localPath, setLocalPath] = useState("");
  const [localEntries, setLocalEntries] = useState<Entry[]>([]);
  const [localLoading, setLocalLoading] = useState(false);

  const [remotePath, setRemotePath] = useState("");
  const [remoteEntries, setRemoteEntries] = useState<Entry[]>([]);
  const [remoteLoading, setRemoteLoading] = useState(false);

  const [selLocal, setSelLocal] = useState<string | null>(null);
  const [selRemote, setSelRemote] = useState<string | null>(null);
  const [xfer, setXfer] = useState<Xfer | null>(null);
  const [queued, setQueued] = useState(0);
  const [menu, setMenu] = useState<{
    side: "local" | "remote";
    name: string | null;
    x: number;
    y: number;
  } | null>(null);

  // Open the SFTP session (reuses the SSH connection) and pick starting dirs.
  useEffect(() => {
    let opened: string | null = null;
    void (async () => {
      try {
        const home = await invoke<string>("local_home");
        setLocalPath(home);
      } catch {
        setLocalPath("/");
      }
      try {
        const res = await invoke<{ id: string; home: string }>("sftp_open", {
          sessionId,
        });
        opened = res.id;
        setSftpId(res.id);
        setRemotePath(res.home || ".");
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      if (opened) void invoke("sftp_close", { sftpId: opened }).catch(() => {});
    };
  }, [sessionId]);

  const loadLocal = useCallback((path: string) => {
    setLocalLoading(true);
    invoke<Entry[]>("local_list", { path })
      .then((e) => setLocalEntries(sortEntries(e)))
      .catch(() => setLocalEntries([]))
      .finally(() => setLocalLoading(false));
  }, []);

  const loadRemote = useCallback((id: string, path: string) => {
    setRemoteLoading(true);
    invoke<Entry[]>("sftp_list", { sftpId: id, path })
      .then((e) => setRemoteEntries(sortEntries(e)))
      .catch(() => setRemoteEntries([]))
      .finally(() => setRemoteLoading(false));
  }, []);

  useEffect(() => {
    if (localPath) loadLocal(localPath);
  }, [localPath, loadLocal]);

  useEffect(() => {
    if (sftpId && remotePath) loadRemote(sftpId, remotePath);
  }, [sftpId, remotePath, loadRemote]);

  // Core transfer. `srcPath` is the full source path (local for "up", remote for
  // "down"); the backend derives the basename and drops it into the target dir.
  // Transfers run one at a time; extra requests (incl. multi-file OS drops)
  // queue and start automatically when the current one finishes.
  const queueRef = useRef<Job[]>([]);
  const activeRef = useRef(false);

  const beginJob = (job: Job) => {
    if (!sftpId) return;
    activeRef.current = true;
    const id = `t-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setXfer({ id, file: baseName(job.srcPath), transferred: 0, total: 0, dir: job.dir });

    const afterEnd = () => {
      activeRef.current = false;
      setXfer(null);
      const next = queueRef.current.shift();
      setQueued(queueRef.current.length);
      if (next) beginJob(next);
    };

    const ch = new Channel<XferEvent>();
    ch.onmessage = (ev) => {
      if (ev.kind === "started")
        setXfer((x) => (x && x.id === id ? { ...x, total: ev.total } : x));
      else if (ev.kind === "file")
        setXfer((x) =>
          x && x.id === id
            ? { ...x, file: ev.name, index: ev.index, count: ev.count }
            : x,
        );
      else if (ev.kind === "progress")
        setXfer((x) =>
          x && x.id === id
            ? { ...x, file: ev.file, transferred: ev.transferred, total: ev.total }
            : x,
        );
      else if (ev.kind === "done") {
        if (job.dir === "up") loadRemote(sftpId, job.remoteDir);
        else loadLocal(job.localDir);
        afterEnd();
      } else if (ev.kind === "cancelled") {
        afterEnd();
      } else if (ev.kind === "error") {
        setError(ev.message);
        afterEnd();
      }
    };

    const args =
      job.dir === "up"
        ? { sftpId, localPath: job.srcPath, remoteDir: job.remoteDir, transferId: id, onProgress: ch }
        : { sftpId, remotePath: job.srcPath, localDir: job.localDir, transferId: id, onProgress: ch };
    invoke(job.dir === "up" ? "sftp_upload" : "sftp_download", args).catch((e) => {
      setError(e instanceof Error ? e.message : String(e));
      afterEnd();
    });
  };

  const runTransfer = (dir: XferDir, srcPath: string) => {
    if (!sftpId) return;
    const job: Job = { dir, srcPath, remoteDir: remotePath, localDir: localPath };
    if (activeRef.current) {
      queueRef.current.push(job);
      setQueued(queueRef.current.length);
    } else {
      beginJob(job);
    }
  };

  const startTransfer = (dir: XferDir) => {
    const sel = dir === "up" ? selLocal : selRemote;
    if (!sel) return;
    runTransfer(dir, dir === "up" ? joinPath(localPath, sel) : joinPath(remotePath, sel));
  };

  const cancelTransfer = () => {
    queueRef.current = [];
    setQueued(0);
    if (xfer) void invoke("sftp_cancel", { transferId: xfer.id }).catch(() => {});
  };

  // File operations (mkdir / rename / delete) on either side.
  const opDir = (side: "local" | "remote") => (side === "local" ? localPath : remotePath);
  const opRefresh = (side: "local" | "remote") => {
    if (side === "local") loadLocal(localPath);
    else if (sftpId) loadRemote(sftpId, remotePath);
  };
  const opErr = (e: unknown) => setError(e instanceof Error ? e.message : String(e));

  const doMkdir = (side: "local" | "remote") => {
    const name = window.prompt("New folder name:")?.trim();
    if (!name) return;
    const path = joinPath(opDir(side), name);
    const p =
      side === "local"
        ? invoke("local_mkdir", { path })
        : invoke("sftp_mkdir", { sftpId, path });
    p.then(() => opRefresh(side)).catch(opErr);
  };

  const doRename = (side: "local" | "remote", oldName: string) => {
    const name = window.prompt("Rename to:", oldName)?.trim();
    if (!name || name === oldName) return;
    const from = joinPath(opDir(side), oldName);
    const to = joinPath(opDir(side), name);
    const p =
      side === "local"
        ? invoke("local_rename", { from, to })
        : invoke("sftp_rename", { sftpId, from, to });
    p.then(() => opRefresh(side)).catch(opErr);
  };

  const doDelete = (side: "local" | "remote", name: string) => {
    if (!window.confirm(`Delete "${name}"? This cannot be undone.`)) return;
    const path = joinPath(opDir(side), name);
    const p =
      side === "local"
        ? invoke("local_remove", { path })
        : invoke("sftp_remove", { sftpId, path });
    p.then(() => {
      opRefresh(side);
      if (side === "local") setSelLocal(null);
      else setSelRemote(null);
    }).catch(opErr);
  };

  // In-app drag-and-drop between the two panes.
  const dragRef = useRef<{ side: "local" | "remote"; name: string } | null>(null);
  const onDropInto = (targetSide: "local" | "remote") => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d || d.side === targetSide) return;
    if (d.side === "local") runTransfer("up", joinPath(localPath, d.name));
    else runTransfer("down", joinPath(remotePath, d.name));
  };

  // OS file drop (from Explorer/Finder) onto the panel → upload to remote.
  const rootRef = useRef<HTMLDivElement>(null);
  const osDropRef = useRef<(paths: string[]) => void>(() => {});
  osDropRef.current = (paths) => {
    for (const p of paths) runTransfer("up", p.replace(/\\/g, "/"));
  };
  useEffect(() => {
    let un: (() => void) | undefined;
    void getCurrentWebview()
      .onDragDropEvent((event) => {
        if (event.payload.type !== "drop") return;
        const el = rootRef.current;
        if (!el) return;
        const r = el.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        const x = event.payload.position.x / dpr;
        const y = event.payload.position.y / dpr;
        if (x < r.left || x > r.right || y < r.top || y > r.bottom) return; // not over panel
        osDropRef.current(event.payload.paths);
      })
      .then((f) => (un = f))
      .catch(() => {});
    return () => un?.();
  }, []);

  return (
    <div
      ref={rootRef}
      className="flex h-full flex-col border-l"
      style={{ background: "var(--m-panel)", borderColor: "var(--m-border)" }}
    >
      <div
        className="flex h-9 shrink-0 items-center justify-between border-b px-3"
        style={{ borderColor: "var(--m-border)" }}
      >
        <span className="text-xs font-semibold" style={{ color: "var(--m-text)" }}>
          File manager (SFTP)
        </span>
        <button
          onClick={onClose}
          className="rounded p-1 opacity-70 transition hover:opacity-100"
          style={{ color: "var(--m-muted)" }}
          title="Close"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {error && (
        <div className="px-3 py-2 text-xs" style={{ color: "#ef4444" }}>
          {error}
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col">
        <FileHalf
          title="Local"
          Icon={HardDrive}
          side="local"
          path={localPath}
          entries={localEntries}
          loading={localLoading}
          selected={selLocal}
          onSelect={setSelLocal}
          onDragItem={(name) => (dragRef.current = { side: "local", name })}
          onDropItem={() => onDropInto("local")}
          onContext={(name, e) => setMenu({ side: "local", name, x: e.clientX, y: e.clientY })}
          onOpen={(name) => {
            setSelLocal(null);
            setLocalPath(joinPath(localPath, name));
          }}
          onUp={() => {
            setSelLocal(null);
            setLocalPath(parentPath(localPath));
          }}
          onRefresh={() => loadLocal(localPath)}
          onPath={setLocalPath}
          transfer={{
            Icon: ArrowDownToLine,
            title: "Upload selected to remote",
            onClick: () => startTransfer("up"),
            disabled: !selLocal || !!xfer || !sftpId,
          }}
        />
        <div className="h-1.5 shrink-0" style={{ background: "var(--m-border)" }} />
        <FileHalf
          title="Remote (VPS)"
          Icon={Server}
          side="remote"
          path={remotePath}
          entries={remoteEntries}
          loading={remoteLoading}
          disabled={!sftpId}
          selected={selRemote}
          onSelect={setSelRemote}
          onDragItem={(name) => (dragRef.current = { side: "remote", name })}
          onDropItem={() => onDropInto("remote")}
          onContext={(name, e) => setMenu({ side: "remote", name, x: e.clientX, y: e.clientY })}
          onOpen={(name) => {
            setSelRemote(null);
            setRemotePath(joinPath(remotePath, name));
          }}
          onUp={() => {
            setSelRemote(null);
            setRemotePath(parentPath(remotePath));
          }}
          onRefresh={() => sftpId && loadRemote(sftpId, remotePath)}
          onPath={setRemotePath}
          transfer={{
            Icon: ArrowUpToLine,
            title: "Download selected to local",
            onClick: () => startTransfer("down"),
            disabled: !selRemote || !!xfer,
          }}
        />
      </div>

      {xfer && (
        <div
          className="shrink-0 border-t px-3 py-2"
          style={{ borderColor: "var(--m-border)" }}
        >
          <div className="mb-1 flex items-center gap-2 text-[11px]">
            <span className="shrink-0" style={{ color: "var(--m-muted)" }}>
              {xfer.dir === "up" ? "Uploading" : "Downloading"}
            </span>
            <span className="min-w-0 flex-1 truncate" style={{ color: "var(--m-text)" }} title={xfer.file}>
              {xfer.file}
              {xfer.count && xfer.count > 1 ? ` (${xfer.index}/${xfer.count})` : ""}
            </span>
            <span className="shrink-0" style={{ color: "var(--m-muted)" }}>
              {fmtSize(xfer.transferred)}
              {xfer.total > 0 ? ` / ${fmtSize(xfer.total)}` : ""}
              {queued > 0 ? ` · +${queued} queued` : ""}
            </span>
            <button onClick={cancelTransfer} title="Cancel" className="shrink-0 rounded p-0.5 hover:bg-black/10" style={{ color: "#ef4444" }}>
              <Ban className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="h-1 w-full overflow-hidden rounded" style={{ background: "var(--m-input)" }}>
            <div
              className="h-full transition-[width] duration-150"
              style={{
                width: xfer.total > 0 ? `${Math.min(100, (xfer.transferred / xfer.total) * 100)}%` : "40%",
                background: "#3b82f6",
              }}
            />
          </div>
        </div>
      )}

      {menu && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu(null);
            }}
          />
          <div
            className="fixed z-50 min-w-36 rounded-md border py-1 shadow-xl"
            style={{ left: menu.x, top: menu.y, background: "var(--m-panel)", borderColor: "var(--m-border)" }}
          >
            {menu.name && (
              <>
                <MenuItem onClick={() => { doRename(menu.side, menu.name!); setMenu(null); }}>
                  Rename…
                </MenuItem>
                <MenuItem danger onClick={() => { doDelete(menu.side, menu.name!); setMenu(null); }}>
                  Delete
                </MenuItem>
                <div className="my-1 border-t" style={{ borderColor: "var(--m-border)" }} />
              </>
            )}
            <MenuItem onClick={() => { doMkdir(menu.side); setMenu(null); }}>
              New folder…
            </MenuItem>
          </div>
        </>
      )}
    </div>
  );
}

function EntryIcon({ entry }: { entry: Entry }) {
  const Icon = entry.isDir ? Folder : iconForFile(entry.name);
  return (
    <Icon
      className="h-3.5 w-3.5 shrink-0"
      style={{ color: entry.isDir ? "#60a5fa" : "var(--m-muted)" }}
    />
  );
}

function MenuItem({
  children,
  onClick,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className="block w-full px-3 py-1.5 text-left text-xs hover:bg-black/10"
      style={{ color: danger ? "#ef4444" : "var(--m-text)" }}
    >
      {children}
    </button>
  );
}

function FileHalf({
  title,
  Icon,
  side,
  path,
  entries,
  loading,
  disabled,
  selected,
  onSelect,
  onOpen,
  onUp,
  onRefresh,
  onPath,
  transfer,
  onDragItem,
  onDropItem,
  onContext,
}: {
  title: string;
  Icon: typeof HardDrive;
  side: "local" | "remote";
  path: string;
  entries: Entry[];
  loading: boolean;
  disabled?: boolean;
  selected: string | null;
  onSelect: (name: string) => void;
  onOpen: (name: string) => void;
  onUp: () => void;
  onRefresh: () => void;
  onPath: (p: string) => void;
  transfer: { Icon: typeof HardDrive; title: string; onClick: () => void; disabled: boolean };
  onDragItem: (name: string) => void;
  onDropItem: () => void;
  onContext: (name: string | null, e: React.MouseEvent) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(path);
  const [dragOver, setDragOver] = useState(false);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Toolbar */}
      <div
        className="flex h-8 shrink-0 items-center gap-1 border-b px-2"
        style={{ borderColor: "var(--m-border)" }}
      >
        <Icon className="h-3.5 w-3.5 shrink-0" style={{ color: "var(--m-muted)" }} />
        <span className="shrink-0 text-[11px] font-medium" style={{ color: "var(--m-muted)" }}>
          {title}
        </span>
        <button onClick={onUp} title="Up" className="ml-1 rounded p-1 hover:bg-black/10" style={{ color: "var(--m-muted)" }} disabled={disabled}>
          <ArrowUp className="h-3.5 w-3.5" />
        </button>
        <button onClick={onRefresh} title="Refresh" className="rounded p-1 hover:bg-black/10" style={{ color: "var(--m-muted)" }} disabled={disabled}>
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={transfer.onClick}
          title={transfer.title}
          disabled={transfer.disabled}
          className="rounded p-1 transition hover:bg-black/10 disabled:opacity-30"
          style={{ color: "#60a5fa" }}
        >
          <transfer.Icon className="h-3.5 w-3.5" />
        </button>
        {editing ? (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => setEditing(false)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                onPath(draft.trim() || path);
                setEditing(false);
              } else if (e.key === "Escape") setEditing(false);
            }}
            className="min-w-0 flex-1 rounded border px-2 py-0.5 text-[11px] outline-none focus:border-cyan-500"
            style={{ background: "var(--m-input)", borderColor: "var(--m-input-border)", color: "var(--m-text)" }}
          />
        ) : (
          <button
            onClick={() => {
              setDraft(path);
              setEditing(true);
            }}
            title={path}
            className="min-w-0 flex-1 truncate rounded px-2 py-0.5 text-left text-[11px] hover:bg-black/10"
            style={{ color: "var(--m-text)" }}
          >
            {path || "…"}
          </button>
        )}
      </div>

      {/* Listing — also a drop target for cross-pane drag + OS file drops. */}
      <div
        className="min-h-0 flex-1 overflow-y-auto"
        style={dragOver ? { outline: "2px dashed #3b82f6", outlineOffset: "-2px" } : undefined}
        onDragOver={(e) => {
          e.preventDefault();
          if (!dragOver) setDragOver(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          onDropItem();
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          onContext(null, e);
        }}
      >
        {loading ? (
          <div className="flex items-center gap-2 px-3 py-2 text-xs" style={{ color: "var(--m-muted)" }}>
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
          </div>
        ) : entries.length === 0 ? (
          <div className="px-3 py-2 text-xs" style={{ color: "var(--m-muted)" }}>
            (empty)
          </div>
        ) : (
          entries.map((e) => (
            <button
              key={e.name}
              draggable
              onDragStart={(ev) => {
                onDragItem(e.name);
                ev.dataTransfer.setData("text/plain", `${side}:${e.name}`);
                ev.dataTransfer.effectAllowed = "copy";
              }}
              onClick={() => onSelect(e.name)}
              onDoubleClick={() => e.isDir && onOpen(e.name)}
              onContextMenu={(ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                onSelect(e.name);
                onContext(e.name, ev);
              }}
              className="flex w-full items-center gap-2 px-3 py-1 text-left text-xs"
              style={{
                color: "var(--m-text)",
                background: selected === e.name ? "var(--m-hover)" : "transparent",
              }}
              title={e.name}
            >
              <EntryIcon entry={e} />
              <span className="min-w-0 flex-1 truncate">{e.name}</span>
              {!e.isDir && (
                <span className="shrink-0 text-[10px]" style={{ color: "var(--m-muted)" }}>
                  {fmtSize(e.size)}
                </span>
              )}
            </button>
          ))
        )}
      </div>
    </div>
  );
}
