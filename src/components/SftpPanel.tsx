import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { invoke, Channel } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useEditorDocs } from "../editorStore";
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
  LinkIcon,
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
type Entry = { name: string; isDir: boolean; size: number; mtime: number; isSymlink?: boolean };

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

/** Format a Unix mtime (seconds) as a compact "YYYY-MM-DD HH:mm". */
const fmtDate = (secs: number): string => {
  if (!secs) return "";
  const d = new Date(secs * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
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

  const [selLocal, setSelLocal] = useState<Set<string>>(new Set());
  const [lastSelLocal, setLastSelLocal] = useState<string | null>(null);
  const [selRemote, setSelRemote] = useState<Set<string>>(new Set());
  const [lastSelRemote, setLastSelRemote] = useState<string | null>(null);
  const [clipboard, setClipboard] = useState<{ op: "copy" | "cut"; side: "local" | "remote"; paths: string[]; baseDir: string } | null>(null);
  const [topHeight, setTopHeight] = useState<number>(50);
  const [xfer, setXfer] = useState<Xfer | null>(null);
  const [queued, setQueued] = useState(0);
  const [menu, setMenu] = useState<{
    side: "local" | "remote";
    name: string | null;
    x: number;
    y: number;
  } | null>(null);

  const menuRef = useRef<HTMLDivElement>(null);
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);

  // Keep the context menu inside the viewport: if it would overflow the
  // bottom or right edge, flip it above/left of the cursor so it stays
  // fully visible.
  useLayoutEffect(() => {
    if (!menu) {
      setMenuPos(null);
      return;
    }
    const el = menuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const pad = 4;
    let x = menu.x;
    let y = menu.y;
    if (y + rect.height > window.innerHeight - pad) {
      y = Math.max(pad, menu.y - rect.height);
    }
    if (x + rect.width > window.innerWidth - pad) {
      x = Math.max(pad, menu.x - rect.width);
    }
    setMenuPos({ x, y });
  }, [menu]);

  const [preview, setPreview] = useState<{ path: string; name: string; isLocal: boolean; size: number } | null>(null);
  const [checksum, setChecksum] = useState<{ name: string; hash: string | null; error?: string } | null>(null);

  const { openDoc, lastSaved, invalidateSftp, rebindSftp } = useEditorDocs();

  /** Images get the read-only preview; every other file opens in the editor. */
  const openEntry = useCallback(
    (p: { path: string; name: string; isLocal: boolean; size: number }) => {
      const ext = p.name.split(".").pop()?.toLowerCase() || "";
      if (IMAGE_EXTS.includes(ext)) setPreview(p);
      else
        openDoc({
          ...p,
          sftpId: p.isLocal ? null : sftpId,
          sessionId: p.isLocal ? null : sessionId,
        });
    },
    [openDoc, sftpId, sessionId],
  );

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
        // Files left open from a previous visit to this session become editable
        // again, now pointed at the new SFTP channel.
        rebindSftp(sessionId, res.id);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      if (!opened) return;
      // Files still open in the editor belong to this session; flag them before
      // it goes away so saving fails loudly instead of silently doing nothing.
      invalidateSftp(opened);
      void invoke("sftp_close", { sftpId: opened }).catch(() => {});
    };
  }, [sessionId, invalidateSftp, rebindSftp]);

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

  // Refresh the affected listing whenever the editor saves a file, so size and
  // modified date stay current. Keyed on the save counter only — re-running on
  // path changes would duplicate the loads those effects already do.
  const savedTick = lastSaved?.n ?? 0;
  const savedLocal = lastSaved?.isLocal ?? false;
  useEffect(() => {
    if (!savedTick) return;
    if (savedLocal) {
      if (localPath) loadLocal(localPath);
    } else if (sftpId && remotePath) {
      loadRemote(sftpId, remotePath);
    }

  }, [savedTick]);

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

  const handleSelect = (side: "local" | "remote", name: string, isShift: boolean, isCtrl: boolean) => {
    const entries = side === "local" ? localEntries : remoteEntries;
    const sel = side === "local" ? selLocal : selRemote;
    const setSel = side === "local" ? setSelLocal : setSelRemote;
    const lastSel = side === "local" ? lastSelLocal : lastSelRemote;
    const setLastSel = side === "local" ? setLastSelLocal : setLastSelRemote;

    if (isCtrl) {
      const newSel = new Set(sel);
      if (newSel.has(name)) newSel.delete(name);
      else newSel.add(name);
      setSel(newSel);
      setLastSel(name);
    } else if (isShift && lastSel) {
      const idx1 = entries.findIndex((e) => e.name === lastSel);
      const idx2 = entries.findIndex((e) => e.name === name);
      if (idx1 >= 0 && idx2 >= 0) {
        const start = Math.min(idx1, idx2);
        const end = Math.max(idx1, idx2);
        const newSel = new Set(sel);
        for (let i = start; i <= end; i++) {
          newSel.add(entries[i].name);
        }
        setSel(newSel);
      }
    } else {
      setSel(new Set([name]));
      setLastSel(name);
    }
  };

  const getTargets = (side: "local" | "remote", name: string): string[] => {
    const sel = side === "local" ? selLocal : selRemote;
    return sel.has(name) ? Array.from(sel) : [name];
  };

  const doCopy = (side: "local" | "remote", name: string) => {
    setClipboard({ op: "copy", side, paths: getTargets(side, name), baseDir: opDir(side) });
  };
  const doCut = (side: "local" | "remote", name: string) => {
    setClipboard({ op: "cut", side, paths: getTargets(side, name), baseDir: opDir(side) });
  };
  const doPaste = (side: "local" | "remote") => {
    if (!clipboard) return;
    if (clipboard.side !== side) {
      clipboard.paths.forEach((p) => {
        runTransfer(side === "local" ? "down" : "up", joinPath(clipboard.baseDir, p));
      });
      if (clipboard.op === "cut") setClipboard(null);
    } else {
      const p = side === "local"
        ? invoke("local_paste", { op: clipboard.op, srcDir: clipboard.baseDir, destDir: opDir(side), names: clipboard.paths })
        : invoke("sftp_paste", { sftpId, op: clipboard.op, srcDir: clipboard.baseDir, destDir: opDir(side), names: clipboard.paths });
      p.then(() => {
        opRefresh(side);
        if (clipboard.op === "cut") setClipboard(null);
      }).catch(opErr);
    }
  };
  const doCompress = (side: "local" | "remote", name: string) => {
    const zipName = window.prompt("Archive name:", name + ".zip")?.trim();
    if (!zipName) return;
    const paths = getTargets(side, name);
    const p = side === "local"
      ? invoke("local_compress", { dir: opDir(side), dest: zipName, names: paths })
      : invoke("sftp_compress", { sftpId, dir: opDir(side), dest: zipName, names: paths });
    p.then(() => opRefresh(side)).catch(opErr);
  };
  const doExtract = (side: "local" | "remote", name: string) => {
    const p = side === "local"
      ? invoke("local_extract", { path: joinPath(opDir(side), name) })
      : invoke("sftp_extract", { sftpId, path: joinPath(opDir(side), name) });
    p.then(() => opRefresh(side)).catch(opErr);
  };
  const doOpenInTerminal = (side: "local" | "remote", name: string) => {
    if (side !== "remote") return;
    const path = joinPath(opDir(side), name);
    const bytes = Array.from(new TextEncoder().encode(`cd "${path}"\n`));
    invoke("session_write", { id: sessionId, data: bytes }).catch(opErr);
  };

  const startTransfer = (dir: XferDir) => {
    const sel = dir === "up" ? selLocal : selRemote;
    sel.forEach((name) => {
      runTransfer(dir, dir === "up" ? joinPath(localPath, name) : joinPath(remotePath, name));
    });
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
      if (side === "local") setSelLocal(new Set());
      else setSelRemote(new Set());
    }).catch(opErr);
  };

  const doChecksum = (side: "local" | "remote", name: string) => {
    const path = joinPath(opDir(side), name);
    setChecksum({ name, hash: null });
    const p =
      side === "local"
        ? invoke<string>("local_checksum", { path })
        : invoke<string>("sftp_checksum", { sftpId, path });
    p.then((hash) => setChecksum({ name, hash })).catch((e) =>
      setChecksum({ name, hash: null, error: e instanceof Error ? e.message : String(e) }),
    );
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

      <div className="flex min-h-0 flex-1 flex-col" ref={rootRef}>
        <div style={{ height: `${topHeight}%`, minHeight: '20%' }} className="flex flex-col">
          <FileHalf
            title="Local"
            Icon={HardDrive}
            side="local"
            path={localPath}
            entries={localEntries}
            loading={localLoading}
            selected={selLocal}
            onSelect={(name, shift, ctrl) => handleSelect("local", name, shift, ctrl)}
            onDragItem={(name) => (dragRef.current = { side: "local", name })}
            onDropItem={() => onDropInto("local")}
            onContext={(name, e) => setMenu({ side: "local", name, x: e.clientX, y: e.clientY })}
            onOpenFile={openEntry}
            onOpen={(name) => {
              setSelLocal(new Set());
              setLocalPath(joinPath(localPath, name));
            }}
            onUp={() => {
              setSelLocal(new Set());
              setLocalPath(parentPath(localPath));
            }}
            onRefresh={() => loadLocal(localPath)}
            onPath={setLocalPath}
            transfer={{
              Icon: ArrowDownToLine,
              title: "Upload selected to remote",
              onClick: () => startTransfer("up"),
              disabled: selLocal.size === 0 || !!xfer || !sftpId,
            }}
          />
        </div>
        
        <div 
          className="h-1.5 shrink-0 cursor-row-resize hover:bg-cyan-500/50 transition-colors z-10"
          style={{ background: "var(--m-border)" }} 
          onPointerDown={(e) => {
            const startY = e.clientY;
            const startH = topHeight;
            const container = rootRef.current;
            if (!container) return;
            const rect = container.getBoundingClientRect();
            
            const onMove = (ev: PointerEvent) => {
              const deltaY = ev.clientY - startY;
              const deltaPct = (deltaY / rect.height) * 100;
              let newH = startH + deltaPct;
              if (newH < 20) newH = 20;
              if (newH > 80) newH = 80;
              setTopHeight(newH);
            };
            const onUp = () => {
              window.removeEventListener("pointermove", onMove);
              window.removeEventListener("pointerup", onUp);
            };
            window.addEventListener("pointermove", onMove);
            window.addEventListener("pointerup", onUp);
          }}
        />

        <div style={{ height: `${100 - topHeight}%`, minHeight: '20%' }} className="flex flex-col">
          <FileHalf
            title="Remote (VPS)"
            Icon={Server}
            side="remote"
            path={remotePath}
            entries={remoteEntries}
            loading={remoteLoading}
            disabled={!sftpId}
            selected={selRemote}
            onSelect={(name, shift, ctrl) => handleSelect("remote", name, shift, ctrl)}
            onDragItem={(name) => (dragRef.current = { side: "remote", name })}
            onDropItem={() => onDropInto("remote")}
            onContext={(name, e) => setMenu({ side: "remote", name, x: e.clientX, y: e.clientY })}
            onOpenFile={openEntry}
            onOpen={(name) => {
              setSelRemote(new Set());
              setRemotePath(joinPath(remotePath, name));
            }}
            onUp={() => {
              setSelRemote(new Set());
              setRemotePath(parentPath(remotePath));
            }}
            onRefresh={() => sftpId && loadRemote(sftpId, remotePath)}
            onPath={setRemotePath}
            transfer={{
              Icon: ArrowUpToLine,
              title: "Download selected to local",
              onClick: () => startTransfer("down"),
              disabled: selRemote.size === 0 || !!xfer,
            }}
          />
        </div>
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
            ref={menuRef}
            className="fixed z-50 min-w-36 rounded-md border py-1 shadow-xl"
            style={{
              left: (menuPos ?? menu).x,
              top: (menuPos ?? menu).y,
              visibility: menuPos ? "visible" : "hidden",
              background: "var(--m-panel)",
              borderColor: "var(--m-border)",
            }}
          >
            {menu.name && (
              <>
                {menu.side === "remote" && (
                  <MenuItem onClick={() => { doOpenInTerminal(menu.side, menu.name!); setMenu(null); }}>
                    Open in Terminal
                  </MenuItem>
                )}
                <MenuItem onClick={() => { doCopy(menu.side, menu.name!); setMenu(null); }}>
                  Copy
                </MenuItem>
                <MenuItem onClick={() => { doCut(menu.side, menu.name!); setMenu(null); }}>
                  Cut
                </MenuItem>
                <div className="my-1 border-t" style={{ borderColor: "var(--m-border)" }} />
                <MenuItem onClick={() => { doCompress(menu.side, menu.name!); setMenu(null); }}>
                  Compress to ZIP
                </MenuItem>
                {(menu.name.endsWith(".zip") || menu.name.endsWith(".tar.gz") || menu.name.endsWith(".tar")) && (
                  <MenuItem onClick={() => { doExtract(menu.side, menu.name!); setMenu(null); }}>
                    Extract
                  </MenuItem>
                )}
                <div className="my-1 border-t" style={{ borderColor: "var(--m-border)" }} />
                <MenuItem onClick={() => { doRename(menu.side, menu.name!); setMenu(null); }}>
                  Rename…
                </MenuItem>
                <MenuItem danger onClick={() => { doDelete(menu.side, menu.name!); setMenu(null); }}>
                  Delete
                </MenuItem>
                <MenuItem onClick={() => { doChecksum(menu.side, menu.name!); setMenu(null); }}>
                  Checksum (SHA-256)
                </MenuItem>
                <div className="my-1 border-t" style={{ borderColor: "var(--m-border)" }} />
              </>
            )}
            <MenuItem disabled={!clipboard} onClick={() => { doPaste(menu.side); setMenu(null); }}>
              Paste
            </MenuItem>
            <MenuItem onClick={() => { doMkdir(menu.side); setMenu(null); }}>
              New folder…
            </MenuItem>
          </div>
        </>
      )}

      {preview && (
        <PreviewModal
          {...preview}
          sftpId={sftpId}
          onClose={() => setPreview(null)}
        />
      )}

      {checksum && (
        <ChecksumModal {...checksum} onClose={() => setChecksum(null)} />
      )}
    </div>
  );
}

function ChecksumModal({
  name,
  hash,
  error,
  onClose,
}: {
  name: string;
  hash: string | null;
  error?: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-lg rounded-lg border shadow-2xl" style={{ background: "var(--m-panel)", borderColor: "var(--m-border)" }}>
        <div className="flex items-center justify-between border-b px-4 py-3" style={{ borderColor: "var(--m-border)" }}>
          <h2 className="truncate text-sm font-semibold" title={name}>SHA-256: {name}</h2>
          <button onClick={onClose} className="rounded p-1 hover:bg-black/10"><X className="h-4 w-4" /></button>
        </div>
        <div className="p-4 text-sm">
          {error ? (
            <div className="text-red-500">{error}</div>
          ) : hash === null ? (
            <div className="flex items-center gap-2" style={{ color: "var(--m-muted)" }}>
              <Loader2 className="h-4 w-4 animate-spin" /> Hashing…
            </div>
          ) : (
            <>
              <code className="block break-all rounded-md border px-3 py-2 font-mono text-xs" style={{ background: "var(--m-input)", borderColor: "var(--m-input-border)" }}>
                {hash}
              </code>
              <button
                onClick={() => { void navigator.clipboard.writeText(hash).then(() => setCopied(true)).catch(() => {}); }}
                className="mt-3 rounded-md bg-blue-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-blue-500"
              >
                {copied ? "Copied!" : "Copy"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function EntryIcon({ entry }: { entry: Entry }) {
  if (entry.isSymlink) {
    return <LinkIcon className="h-3.5 w-3.5 shrink-0" style={{ color: "#c084fc" }} />;
  }
  const Icon = entry.isDir ? Folder : iconForFile(entry.name);
  return (
    <Icon
      className="h-3.5 w-3.5 shrink-0"
      style={{ color: entry.isDir ? "#60a5fa" : "var(--m-muted)" }}
    />
  );
}

const IMAGE_EXTS = ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico", "avif"];

/** Read-only preview for images. Text files open in the editor overlay instead. */
function PreviewModal({
  path,
  name,
  isLocal,
  sftpId,
  onClose,
}: {
  path: string;
  name: string;
  isLocal: boolean;
  sftpId: string | null;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const ext = name.split(".").pop()?.toLowerCase() || "";
        const res = await invoke<number[]>(
          isLocal ? "local_preview" : "sftp_preview",
          isLocal ? { path } : { sftpId, path },
        );
        if (!active) return;
        const type = ext === "svg" ? "image/svg+xml" : `image/${ext === "jpg" ? "jpeg" : ext}`;
        setUrl(URL.createObjectURL(new Blob([new Uint8Array(res)], { type })));
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [path, isLocal, sftpId, name]);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4">
      <div className="flex max-h-full w-full max-w-2xl flex-col rounded-lg border shadow-2xl" style={{ background: "var(--m-panel)", borderColor: "var(--m-border)" }}>
        <div className="flex shrink-0 items-center justify-between border-b px-4 py-3" style={{ borderColor: "var(--m-border)" }}>
          <h2 className="truncate text-sm font-semibold" title={path}>Preview: {name}</h2>
          <button onClick={onClose} className="rounded p-1 hover:bg-black/10"><X className="h-4 w-4" /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-4 text-sm">
          {loading && (
            <div className="flex h-32 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin opacity-50" />
            </div>
          )}
          {error && <div className="text-red-500">{error}</div>}
          {url && <img src={url} alt={name} className="mx-auto max-h-full max-w-full rounded" />}
        </div>
      </div>
    </div>
  );
}

function MenuItem({
  children,
  onClick,
  danger,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={() => { if (!disabled) onClick(); }}
      className={`block w-full px-3 py-1.5 text-left text-xs ${disabled ? "opacity-50 cursor-not-allowed" : "hover:bg-black/10"}`}
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
  onOpenFile,
}: {
  title: string;
  Icon: typeof HardDrive;
  side: "local" | "remote";
  path: string;
  entries: Entry[];
  loading: boolean;
  disabled?: boolean;
  selected: Set<string>;
  onSelect: (name: string, isShift: boolean, isCtrl: boolean) => void;
  onOpen: (name: string) => void;
  onUp: () => void;
  onRefresh: () => void;
  onPath: (p: string) => void;
  transfer: { Icon: typeof HardDrive; title: string; onClick: () => void; disabled: boolean };
  onDragItem: (name: string) => void;
  onDropItem: () => void;
  onContext: (name: string | null, e: React.MouseEvent) => void;
  onOpenFile: (p: { path: string; name: string; isLocal: boolean; size: number }) => void;
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
              onClick={(ev) => onSelect(e.name, ev.shiftKey, ev.metaKey || ev.ctrlKey)}
                onDoubleClick={() => {
                  if (e.isDir) onOpen(e.name);
                  else onOpenFile({ path: joinPath(path, e.name), name: e.name, isLocal: side === "local", size: e.size });
                }}
              onContextMenu={(ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                if (!selected.has(e.name)) onSelect(e.name, false, false);
                onContext(e.name, ev);
              }}
              className="flex w-full items-center gap-2 px-3 py-1 text-left text-xs"
              style={{
                color: "var(--m-text)",
                background: selected.has(e.name) ? "var(--m-hover)" : "transparent",
              }}
              title={e.name}
            >
              <EntryIcon entry={e} />
              <span className="min-w-0 flex-1 truncate">{e.name}</span>
              <span
                className="shrink-0 text-right text-[10px] tabular-nums"
                style={{ color: "var(--m-muted)" }}
                title={e.mtime ? fmtDate(e.mtime) : undefined}
              >
                {fmtDate(e.mtime)}
              </span>
              <span
                className="w-12 shrink-0 text-right text-[10px] tabular-nums"
                style={{ color: "var(--m-muted)" }}
              >
                {e.isDir ? "" : fmtSize(e.size)}
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
