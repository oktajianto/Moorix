// Shared state for the in-app file editor.
//
// The editor used to be a single-file modal owned by SftpPanel, which made it
// impossible to keep more than one file open. State lives here instead, above
// the panel, so documents survive panel re-renders and several files can be
// open — and arranged side by side — at once.
//
// Two layers: `docs` is the flat set of open files (the tab bar), and `tree` is
// the split layout, where each pane points at one of those docs by id. Closing
// a pane never closes the document, matching how VS Code splits behave.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

import {
  closeLeaf,
  findLeaf,
  firstLeaf,
  makeLeaf,
  mapLeaves,
  setPaneDoc,
  setSizesAtPath,
  splitLeaf,
  type EditorNode,
} from "./editorTree";

/** Files above this size ask for confirmation before being downloaded. */
export const EDIT_SOFT_CAP = 1024 * 1024; // 1 MB

/** Refused outright. Must match EDIT_HARD_CAP in the Rust backend. */
export const EDIT_HARD_CAP = 10 * 1024 * 1024; // 10 MB

/**
 * Extensions we can reject without downloading. The backend still checks for
 * NUL bytes and invalid UTF-8, which catches binaries with innocent names;
 * this list only spares the user a pointless download.
 */
const BINARY_EXTS = new Set([
  "zip", "tar", "gz", "tgz", "rar", "7z", "bz2", "xz", "zst", "iso", "dmg", "img",
  "png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "avif", "tiff", "psd",
  "mp4", "mkv", "avi", "mov", "webm", "flv", "mp3", "wav", "flac", "ogg", "m4a", "aac",
  "exe", "dll", "so", "dylib", "bin", "msi", "apk", "jar", "class", "wasm", "pyc", "node",
  "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods",
  "ttf", "otf", "woff", "woff2", "eot",
  "db", "sqlite", "sqlite3", "mdb", "pack", "idx",
]);

const asMB = (n: number) => (n / (1024 * 1024)).toFixed(1);

export type EditorDocPhase = "confirm" | "loading" | "ready" | "error";

export type EditorDoc = {
  /** Unique per side+path, e.g. "remote:/etc/nginx.conf". Also the Monaco model path. */
  id: string;
  path: string;
  name: string;
  isLocal: boolean;
  /** SFTP session this remote file belongs to; null for local files. */
  sftpId: string | null;
  /**
   * The SSH session behind that SFTP session. Outlives `sftpId`, which is
   * re-issued every time the file manager is reopened, so it's what lets a
   * reopened panel reconnect its documents.
   */
  sessionId: string | null;
  size: number;
  /**
   * The SFTP session this remote file came from has gone away (panel closed,
   * tab closed). The document stays open and readable, but can't be saved.
   */
  sessionClosed: boolean;
  phase: EditorDocPhase;
  error: string;
  /** Last saved content, for the dirty comparison. */
  original: string;
  text: string;
  saving: boolean;
  saveErr: string;
};

export type OpenRequest = {
  path: string;
  name: string;
  isLocal: boolean;
  sftpId: string | null;
  sessionId: string | null;
  size: number;
};

/**
 * Identity of an open document — also the Monaco model path, so it must be
 * unique. Remote paths include the SSH session: the same path on two different
 * servers is two different files, and without this they would share one tab.
 */
export const docId = (isLocal: boolean, path: string, sessionId: string | null) =>
  isLocal ? `local:${path}` : `remote:${sessionId ?? "?"}:${path}`;

export const isDirty = (d: EditorDoc) => d.phase === "ready" && d.text !== d.original;

/**
 * Decide how a document opens, using only what the listing already told us
 * (name + size) so hopeless files never trigger a download.
 */
function initialState(name: string, size: number): { phase: EditorDocPhase; error: string } {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (BINARY_EXTS.has(ext)) {
    return { phase: "error", error: "Binary file — cannot edit as text." };
  }
  if (size > EDIT_HARD_CAP) {
    return {
      phase: "error",
      error: `File too large to edit (${asMB(size)} MB; max ${asMB(EDIT_HARD_CAP)} MB).`,
    };
  }
  // Large but workable: ask before pulling the whole file down.
  return { phase: size > EDIT_SOFT_CAP ? "confirm" : "loading", error: "" };
}

type EditorCtx = {
  docs: EditorDoc[];
  /** Split layout; null when nothing is open. */
  tree: EditorNode | null;
  activePaneId: string | null;
  /** The document shown by the active pane. */
  active: EditorDoc | null;
  minimized: boolean;
  /** Bumped after every successful save so the file listing can refresh. */
  lastSaved: { isLocal: boolean; n: number } | null;
  openDoc: (r: OpenRequest) => void;
  closeDoc: (id: string) => void;
  closeAll: () => void;
  /** Point the active pane at a document (what clicking a tab does). */
  showDoc: (id: string) => void;
  /** Mark every document from a now-dead SFTP session as unsaveable. */
  invalidateSftp: (sftpId: string) => void;
  /** Reattach documents to a freshly opened SFTP session, making them editable again. */
  rebindSftp: (sessionId: string, sftpId: string) => void;
  patchDoc: (id: string, patch: Partial<EditorDoc>) => void;
  setActivePane: (paneId: string) => void;
  /** Split a pane; the new pane shows `docId`, or the source pane's file. */
  splitPane: (paneId: string, dir: "row" | "col", docId?: string) => void;
  closePane: (paneId: string) => void;
  resizePane: (path: number[], sizes: number[]) => void;
  setMinimized: (b: boolean) => void;
  signalSaved: (isLocal: boolean) => void;
};

const Ctx = createContext<EditorCtx | null>(null);

export function useEditorDocs(): EditorCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useEditorDocs must be used inside <EditorProvider>");
  return ctx;
}

export function EditorProvider({ children }: { children: React.ReactNode }) {
  const [docs, setDocs] = useState<EditorDoc[]>([]);
  const [tree, setTree] = useState<EditorNode | null>(null);
  const [activePaneId, setActivePaneIdState] = useState<string | null>(null);
  const [minimized, setMinimized] = useState(false);
  const [lastSaved, setLastSaved] = useState<{ isLocal: boolean; n: number } | null>(null);

  // Mirrors of the state above, so handlers can read the current values without
  // doing their work inside a setState updater (which React may run twice).
  const docsRef = useRef<EditorDoc[]>([]);
  const treeRef = useRef<EditorNode | null>(null);
  const activePaneRef = useRef<string | null>(null);

  const applyDocs = useCallback((next: EditorDoc[]) => {
    docsRef.current = next;
    setDocs(next);
  }, []);
  const applyTree = useCallback((next: EditorNode | null) => {
    treeRef.current = next;
    setTree(next);
  }, []);
  const setActivePane = useCallback((paneId: string | null) => {
    activePaneRef.current = paneId;
    setActivePaneIdState(paneId);
  }, []);

  /** Keep the active pane pointing at a pane that still exists. */
  useEffect(() => {
    if (!tree) {
      if (activePaneId !== null) setActivePane(null);
      return;
    }
    if (!activePaneId || !findLeaf(tree, activePaneId)) {
      setActivePane(firstLeaf(tree).paneId);
    }
  }, [tree, activePaneId, setActivePane]);

  const openDoc = useCallback((r: OpenRequest) => {
    const id = docId(r.isLocal, r.path, r.sessionId);
    const existing = docsRef.current.find((d) => d.id === id);
    if (!existing) {
      applyDocs([
        ...docsRef.current,
        {
          id,
          path: r.path,
          name: r.name,
          isLocal: r.isLocal,
          sftpId: r.sftpId,
          sessionId: r.sessionId,
          size: r.size,
          sessionClosed: false,
          ...initialState(r.name, r.size),
          original: "",
          text: "",
          saving: false,
          saveErr: "",
        },
      ]);
    }

    const t = treeRef.current;
    if (!t) {
      const leaf = makeLeaf(id);
      applyTree(leaf);
      setActivePane(leaf.paneId);
    } else {
      const target =
        activePaneRef.current && findLeaf(t, activePaneRef.current)
          ? activePaneRef.current
          : firstLeaf(t).paneId;
      applyTree(setPaneDoc(t, target, id));
      setActivePane(target);
    }
    setMinimized(false);
  }, [applyDocs, applyTree, setActivePane]);

  const closeAll = useCallback(() => {
    applyDocs([]);
    applyTree(null);
    setActivePane(null);
  }, [applyDocs, applyTree, setActivePane]);

  const closeDoc = useCallback((id: string) => {
    const prev = docsRef.current;
    const next = prev.filter((d) => d.id !== id);
    if (next.length === 0) {
      closeAll();
      return;
    }
    applyDocs(next);

    // Panes showing the closed document fall back to its neighbour.
    const i = prev.findIndex((d) => d.id === id);
    const fallback = next[Math.min(i, next.length - 1)].id;
    const t = treeRef.current;
    if (t) applyTree(mapLeaves(t, (l) => (l.docId === id ? { ...l, docId: fallback } : l)));
  }, [applyDocs, applyTree, closeAll]);

  const showDoc = useCallback((id: string) => {
    const t = treeRef.current;
    if (!t) {
      const leaf = makeLeaf(id);
      applyTree(leaf);
      setActivePane(leaf.paneId);
      return;
    }
    const target =
      activePaneRef.current && findLeaf(t, activePaneRef.current)
        ? activePaneRef.current
        : firstLeaf(t).paneId;
    applyTree(setPaneDoc(t, target, id));
    setActivePane(target);
  }, [applyTree, setActivePane]);

  const patchDoc = useCallback((id: string, patch: Partial<EditorDoc>) => {
    applyDocs(docsRef.current.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  }, [applyDocs]);

  const invalidateSftp = useCallback((sftpId: string) => {
    applyDocs(
      docsRef.current.map((d) => (d.sftpId === sftpId ? { ...d, sessionClosed: true } : d)),
    );
  }, [applyDocs]);

  const rebindSftp = useCallback((sessionId: string, sftpId: string) => {
    applyDocs(
      docsRef.current.map((d) =>
        d.sessionId === sessionId ? { ...d, sftpId, sessionClosed: false } : d,
      ),
    );
  }, [applyDocs]);

  const splitPane = useCallback((paneId: string, dir: "row" | "col", docId?: string) => {
    const t = treeRef.current;
    if (!t) return;
    const src = findLeaf(t, paneId);
    if (!src) return;
    // Default to the source pane's file (splitting one file against itself).
    const target = docId ?? src.docId;
    const leaf = makeLeaf(target);
    applyTree(splitLeaf(t, paneId, dir, leaf));
    setActivePane(leaf.paneId);

    // Move the chosen file's tab next to the one it now sits beside, so the tab
    // bar mirrors the split layout (as Chrome does when you split a tab).
    if (target && src.docId && target !== src.docId) {
      const list = docsRef.current;
      const from = list.findIndex((d) => d.id === target);
      if (from >= 0) {
        const next = list.slice();
        const [moved] = next.splice(from, 1);
        // Re-find the anchor: removing the moved tab may have shifted it.
        const anchor = next.findIndex((d) => d.id === src.docId);
        if (anchor >= 0) {
          next.splice(anchor + 1, 0, moved);
          applyDocs(next);
        }
      }
    }
  }, [applyTree, applyDocs, setActivePane]);

  const closePane = useCallback((paneId: string) => {
    const t = treeRef.current;
    if (!t) return;
    const next = closeLeaf(t, paneId);
    if (!next) closeAll(); // closing the only pane closes the editor
    else applyTree(next);
  }, [applyTree, closeAll]);

  const resizePane = useCallback((path: number[], sizes: number[]) => {
    const t = treeRef.current;
    if (t) applyTree(setSizesAtPath(t, path, sizes));
  }, [applyTree]);

  const signalSaved = useCallback((isLocal: boolean) => {
    setLastSaved((p) => ({ isLocal, n: (p?.n ?? 0) + 1 }));
  }, []);

  const activeLeaf = tree && activePaneId ? findLeaf(tree, activePaneId) : null;
  const active = docs.find((d) => d.id === activeLeaf?.docId) ?? null;

  const value = useMemo<EditorCtx>(
    () => ({
      docs, tree, activePaneId, active, minimized, lastSaved,
      openDoc, closeDoc, closeAll, showDoc, patchDoc, invalidateSftp, rebindSftp,
      setActivePane, splitPane, closePane, resizePane,
      setMinimized, signalSaved,
    }),
    [
      docs, tree, activePaneId, active, minimized, lastSaved,
      openDoc, closeDoc, closeAll, showDoc, patchDoc, invalidateSftp, rebindSftp,
      setActivePane, splitPane, closePane, resizePane, signalSaved,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
