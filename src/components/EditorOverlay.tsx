// The in-app editor surface: a floating overlay holding every open file as a
// tab, with a split layout underneath. Minimising collapses it to a pill so the
// file manager stays usable while files remain open.
//
// One shared tab bar lists the open documents; each pane displays one of them.
// Clicking a tab retargets the *active* pane, and splitting asks which file the
// new pane should hold — so two files end up side by side in one gesture.

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import Editor, { type OnMount } from "@monaco-editor/react";
import type { editor as MonacoEditorNs } from "monaco-editor";
import {
  Loader2, Save, X, WrapText, Maximize2, Minimize2, Minus, Pencil, Search,
  SquareSplitHorizontal, SquareSplitVertical,
} from "lucide-react";

import { languageForFile } from "../monaco";
import { isDirty, useEditorDocs, type EditorDoc } from "../editorStore";
import { findLeaf, keyOf, leafCount, MIN_PANE, type EditorLeaf, type EditorNode } from "../editorTree";

type MonacoApi = Parameters<OnMount>[1];

export function EditorOverlay() {
  const {
    docs, tree, activePaneId, active, minimized, setMinimized,
    showDoc, closeDoc, closeAll, patchDoc, signalSaved,
    setActivePane, splitPane, closePane, resizePane,
  } = useEditorDocs();

  const [maximized, setMaximized] = useState(false);
  const [wrap, setWrap] = useState(true);
  const monacoRef = useRef<MonacoApi | null>(null);
  const loadingRef = useRef<Set<string>>(new Set());

  // Fetch the full contents of any document that has entered "loading".
  useEffect(() => {
    for (const d of docs) {
      if (d.phase !== "loading" || loadingRef.current.has(d.id)) continue;
      loadingRef.current.add(d.id);
      void (async () => {
        try {
          const text = await invoke<string>(
            d.isLocal ? "local_read_text" : "sftp_read_text",
            d.isLocal ? { path: d.path } : { sftpId: d.sftpId, path: d.path },
          );
          patchDoc(d.id, { phase: "ready", original: text, text });
        } catch (e) {
          patchDoc(d.id, { phase: "error", error: e instanceof Error ? e.message : String(e) });
        } finally {
          loadingRef.current.delete(d.id);
        }
      })();
    }
  }, [docs, patchDoc]);

  /** Save whichever document the given pane is currently showing. */
  const savePane = useCallback(async (paneId: string | null) => {
    if (!paneId || !tree) return;
    const leaf = findLeaf(tree, paneId);
    const d = docs.find((x) => x.id === leaf?.docId);
    if (!d || d.phase !== "ready") return;
    if (d.sessionClosed) {
      patchDoc(d.id, { saveErr: "SFTP session closed — reopen the file manager to save." });
      return;
    }

    patchDoc(d.id, { saving: true, saveErr: "" });
    try {
      if (d.isLocal) await invoke("local_write", { path: d.path, content: d.text });
      else await invoke("sftp_write", { sftpId: d.sftpId, path: d.path, content: d.text });
      patchDoc(d.id, { original: d.text, saving: false });
      signalSaved(d.isLocal);
    } catch (e) {
      patchDoc(d.id, { saving: false, saveErr: e instanceof Error ? e.message : String(e) });
    }
  }, [tree, docs, patchDoc, signalSaved]);

  // Monaco commands capture their closure once, so route Ctrl/Cmd+S via a ref.
  const saveRef = useRef(savePane);
  saveRef.current = savePane;

  const disposeModel = useCallback((id: string) => {
    const monaco = monacoRef.current;
    if (!monaco) return;
    const uri = monaco.Uri.parse(id).toString();
    monaco.editor
      .getModels()
      .find((m: MonacoEditorNs.ITextModel) => m.uri.toString() === uri)
      ?.dispose();
  }, []);

  /** Close a tab, guarding unsaved work and disposing its Monaco model. */
  const closeTab = useCallback((d: EditorDoc) => {
    if (isDirty(d) && !window.confirm(`"${d.name}" has unsaved changes. Discard them?`)) return;
    disposeModel(d.id);
    closeDoc(d.id);
  }, [closeDoc, disposeModel]);

  const closeEverything = useCallback(() => {
    const dirtyCount = docs.filter(isDirty).length;
    if (dirtyCount > 0 && !window.confirm(`${dirtyCount} file(s) have unsaved changes. Discard them?`)) return;
    monacoRef.current?.editor.getModels().forEach((m: MonacoEditorNs.ITextModel) => m.dispose());
    closeAll();
  }, [docs, closeAll]);

  const onEditorMount = useCallback<OnMount>((_editor, monaco) => {
    monacoRef.current = monaco;
  }, []);

  // Ctrl/Cmd+S is handled here rather than per-editor: Monaco's standalone
  // keybinding service is shared across the window, so registering the same
  // chord in every pane leaves one handler winning for all of them — which
  // silently saved the wrong pane's file. One listener keyed on the currently
  // active pane is both correct and simpler.
  useEffect(() => {
    if (minimized) return; // don't hijack Ctrl+S while the editor is tucked away
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "s") return;
      e.preventDefault();
      void saveRef.current(activePaneId);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [minimized, activePaneId]);

  // Open Monaco's find widget on the active pane's editor. Prefer whichever
  // editor already holds the caret; otherwise fall back to the one showing the
  // active pane's document, then to the first editor.
  const openFind = useCallback(() => {
    const monaco = monacoRef.current;
    if (!monaco) return;
    const editors = monaco.editor.getEditors();
    if (editors.length === 0) return;

    let target = editors.find((ed: MonacoEditorNs.ICodeEditor) => ed.hasTextFocus()) ?? null;
    if (!target && activePaneId && tree) {
      const docId = findLeaf(tree, activePaneId)?.docId;
      if (docId) {
        const uri = monaco.Uri.parse(docId).toString();
        target = editors.find((ed: MonacoEditorNs.ICodeEditor) => ed.getModel()?.uri.toString() === uri) ?? null;
      }
    }
    target ??= editors[0];

    target.focus();
    void target.getAction("actions.find")?.run();
  }, [activePaneId, tree]);

  // Ctrl/Cmd+F must open Monaco's find widget, but App's global hotkey
  // dispatcher (document, capture phase) maps Ctrl+F to the *terminal* find and
  // preventDefault/stopPropagation-s it — so unless the caret already sits in
  // Monaco's hidden textarea, the widget never opens. Claim the chord first on
  // the window (capture runs window → document, so we win) and drive Monaco's
  // find action directly on the active pane's editor.
  useEffect(() => {
    if (minimized) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== "f") return;
      if (!monacoRef.current || monacoRef.current.editor.getEditors().length === 0) return;
      e.preventDefault();
      e.stopPropagation();
      openFind();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [minimized, openFind]);

  const options = useMemo(
    () => ({
      fontSize: 13,
      minimap: { enabled: true },
      scrollBeyondLastLine: false,
      automaticLayout: true,
      wordWrap: (wrap ? "on" : "off") as "on" | "off",
    }),
    [wrap],
  );

  if (docs.length === 0 || !tree) return null;

  const anyDirty = docs.some(isDirty);

  // Minimised: just a pill, so the file manager underneath stays usable.
  if (minimized) {
    return (
      <button
        onClick={() => setMinimized(false)}
        className="fixed bottom-4 right-4 z-[60] flex items-center gap-2 rounded-full border px-4 py-2 text-xs font-medium shadow-lg"
        style={{ background: "var(--m-panel)", borderColor: "var(--m-border)", color: "var(--m-text)" }}
        title="Restore editor"
      >
        <Pencil className="h-3.5 w-3.5 opacity-70" />
        {docs.length} file{docs.length > 1 ? "s" : ""}
        {anyDirty && <span className="h-2 w-2 rounded-full bg-amber-400" title="Unsaved changes" />}
      </button>
    );
  }

  const isLight = document.documentElement.classList.contains("light");
  const activeDirty = active ? isDirty(active) : false;
  const panes = leafCount(tree);

  return (
    <div className={`fixed inset-0 z-[60] flex items-center justify-center bg-black/60 ${maximized ? "p-1" : "p-4"}`}>
      <div
        className={`flex flex-col overflow-hidden rounded-lg border shadow-2xl ${maximized ? "max-w-none w-[98vw] h-[97vh]" : "w-full max-w-5xl h-[82vh]"}`}
        style={{ background: "var(--m-panel)", borderColor: "var(--m-border)" }}
      >
        {/* Tab bar + window controls */}
        <div className="flex shrink-0 items-center gap-2 border-b pr-2" style={{ borderColor: "var(--m-border)" }}>
          <div className="flex min-w-0 flex-1 overflow-x-auto">
            {docs.map((d) => {
              const on = d.id === active?.id;
              return (
                <div
                  key={d.id}
                  onClick={() => showDoc(d.id)}
                  title={d.path}
                  className="group flex max-w-[220px] shrink-0 cursor-pointer items-center gap-2 border-r px-3 py-2 text-xs"
                  style={{
                    borderColor: "var(--m-border)",
                    background: on ? "var(--m-hover)" : "transparent",
                    color: on ? "var(--m-text)" : "var(--m-muted)",
                  }}
                >
                  <span className="truncate">{d.name}</span>
                  {isDirty(d) && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />}
                  <button
                    onClick={(e) => { e.stopPropagation(); closeTab(d); }}
                    className="shrink-0 rounded p-0.5 opacity-0 hover:bg-black/20 group-hover:opacity-100"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              );
            })}
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            {active?.phase === "ready" && (
              <>
                <button
                  onClick={openFind}
                  title="Find (Ctrl+F)"
                  className="rounded p-1 hover:bg-black/10"
                  style={{ color: "var(--m-muted)" }}
                >
                  <Search className="h-4 w-4" />
                </button>
                <button
                  onClick={() => setWrap((w) => !w)}
                  title={wrap ? "Word wrap: on" : "Word wrap: off"}
                  className={`rounded p-1 hover:bg-black/10 ${wrap ? "text-blue-500" : ""}`}
                  style={wrap ? undefined : { color: "var(--m-muted)" }}
                >
                  <WrapText className="h-4 w-4" />
                </button>
                {active.sessionClosed && (
                  <span
                    className="rounded px-2 py-0.5 text-[10px] font-medium"
                    style={{ background: "var(--m-hover)", color: "var(--m-muted)" }}
                    title="The SFTP session for this file was closed — it is read-only now."
                  >
                    read-only
                  </span>
                )}
                <button
                  onClick={() => void savePane(activePaneId)}
                  disabled={active.saving || !activeDirty || active.sessionClosed}
                  title={active.sessionClosed ? "SFTP session closed" : undefined}
                  className="flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50"
                >
                  {active.saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                  {active.saving ? "Saving…" : "Save"}
                </button>
              </>
            )}
            <button onClick={() => setMinimized(true)} title="Minimize" className="rounded p-1 hover:bg-black/10">
              <Minus className="h-4 w-4" />
            </button>
            <button onClick={() => setMaximized((m) => !m)} title={maximized ? "Restore" : "Maximize"} className="rounded p-1 hover:bg-black/10">
              {maximized ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </button>
            <button onClick={closeEverything} title="Close editor" className="rounded p-1 hover:bg-black/10">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {active?.saveErr && (
          <div className="shrink-0 border-b px-4 py-2 text-xs text-red-500" style={{ borderColor: "var(--m-border)" }}>
            {active.saveErr}
          </div>
        )}

        {/* Split layout */}
        <div className="flex min-h-0 flex-1 p-1">
          <Panes
            node={tree}
            path={[]}
            docs={docs}
            activePaneId={activePaneId}
            paneCount={panes}
            theme={isLight ? "light" : "vs-dark"}
            options={options}
            onFocusPane={setActivePane}
            onSplit={splitPane}
            onClosePane={closePane}
            onResize={resizePane}
            onMount={onEditorMount}
            onChangeDoc={patchDoc}
            onCloseDoc={closeTab}
          />
        </div>
      </div>
    </div>
  );
}

type PaneActions = {
  docs: EditorDoc[];
  activePaneId: string | null;
  paneCount: number;
  theme: string;
  options: MonacoEditorNs.IStandaloneEditorConstructionOptions;
  onFocusPane: (paneId: string) => void;
  onSplit: (paneId: string, dir: "row" | "col", docId?: string) => void;
  onClosePane: (paneId: string) => void;
  onResize: (path: number[], sizes: number[]) => void;
  onMount: OnMount;
  onChangeDoc: (id: string, patch: Partial<EditorDoc>) => void;
  onCloseDoc: (d: EditorDoc) => void;
};

function Panes({ node, path, ...a }: { node: EditorNode; path: number[] } & PaneActions) {
  if (node.type === "leaf") {
    return <Leaf node={node} {...a} />;
  }

  const isRow = node.dir === "row";
  return (
    <div className="flex min-h-0 min-w-0 flex-1" style={{ flexDirection: isRow ? "row" : "column" }}>
      {node.children.map((child, i) => (
        <Fragment key={keyOf(child)}>
          {i > 0 && (
            <Divider
              dir={node.dir}
              onResize={(delta, total) => {
                const df = delta / total;
                const before = node.sizes[i - 1];
                const after = node.sizes[i];
                const clamped = Math.max(-(before - MIN_PANE), Math.min(after - MIN_PANE, df));
                const next = node.sizes.slice();
                next[i - 1] = before + clamped;
                next[i] = after - clamped;
                a.onResize(path, next);
              }}
            />
          )}
          <div className="flex min-h-0 min-w-0" style={{ flexGrow: node.sizes[i], flexBasis: 0 }}>
            <Panes node={child} path={[...path, i]} {...a} />
          </div>
        </Fragment>
      ))}
    </div>
  );
}

/**
 * One pane: its split/close toolbar and the document it shows.
 *
 * Splitting asks which file the new pane should hold whenever more than one is
 * open, so arranging a side-by-side view is a single gesture. (An earlier
 * drag-a-tab-onto-a-pane approach was dropped: Monaco does its own drag-and-drop
 * handling inside the editor area, which made drops unreliable.)
 */
function Leaf({ node, ...a }: { node: EditorLeaf } & PaneActions) {
  const [menuDir, setMenuDir] = useState<"row" | "col" | null>(null);
  const doc = a.docs.find((d) => d.id === node.docId) ?? null;
  const isActive = node.paneId === a.activePaneId;

  const split = (dir: "row" | "col") => {
    // With a single file there is nothing to choose — just split it.
    if (a.docs.length < 2) a.onSplit(node.paneId, dir);
    else setMenuDir(dir);
  };

  return (
    <div
      onPointerDownCapture={() => a.onFocusPane(node.paneId)}
      className="group relative flex min-h-0 min-w-0 flex-1 overflow-hidden rounded"
      style={{
        outline: `1px solid ${isActive ? "var(--m-accent)" : "transparent"}`,
        outlineOffset: "-1px",
      }}
    >
      <div
        className={`absolute right-2 top-2 z-10 flex gap-0.5 transition ${
          menuDir ? "opacity-100" : "pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100"
        }`}
      >
        <PaneButton title="Split right" onClick={() => split("row")}>
          <SquareSplitHorizontal size={14} />
        </PaneButton>
        <PaneButton title="Split down" onClick={() => split("col")}>
          <SquareSplitVertical size={14} />
        </PaneButton>
        {a.paneCount > 1 && (
          <PaneButton title="Close pane" onClick={() => a.onClosePane(node.paneId)}>
            <X size={14} />
          </PaneButton>
        )}
      </div>

      {menuDir && (
        <>
          {/* Click-away closes the picker. */}
          <div className="fixed inset-0 z-20" onClick={() => setMenuDir(null)} />
          <div
            className="absolute right-2 top-10 z-30 max-h-64 w-56 overflow-y-auto rounded-md border py-1 shadow-xl"
            style={{ background: "var(--m-panel)", borderColor: "var(--m-border)" }}
          >
            <div className="px-3 py-1 text-[10px] uppercase tracking-wide" style={{ color: "var(--m-muted)" }}>
              Split {menuDir === "row" ? "right" : "down"} with
            </div>
            {a.docs.map((d) => (
              <button
                key={d.id}
                onClick={() => {
                  a.onSplit(node.paneId, menuDir, d.id);
                  setMenuDir(null);
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-black/10"
                style={{ color: "var(--m-text)" }}
                title={d.path}
              >
                <span className="truncate">{d.name}</span>
                {d.id === node.docId && (
                  <span className="ml-auto shrink-0 text-[10px]" style={{ color: "var(--m-muted)" }}>
                    current
                  </span>
                )}
              </button>
            ))}
          </div>
        </>
      )}

      <PaneBody doc={doc} {...a} />
    </div>
  );
}

/** Whatever the pane's document is currently doing: prompt, load, error, edit. */
function PaneBody({
  doc,
  theme,
  options,
  onMount,
  onChangeDoc,
  onCloseDoc,
}: { doc: EditorDoc | null } & PaneActions) {
  if (!doc) {
    return (
      <div className="flex flex-1 items-center justify-center text-xs" style={{ color: "var(--m-muted)" }}>
        No file in this pane
      </div>
    );
  }

  if (doc.phase === "confirm") {
    return (
      <div className="flex flex-1 flex-col gap-4 p-6 text-sm" style={{ color: "var(--m-text)" }}>
        <p>
          This file is <strong>{(doc.size / (1024 * 1024)).toFixed(1)} MB</strong>. Editing large
          files may be slow and will download the whole file first. Continue?
        </p>
        <div className="flex gap-2">
          <button
            onClick={() => onCloseDoc(doc)}
            className="rounded-md border px-4 py-1.5 text-xs"
            style={{ borderColor: "var(--m-border)" }}
          >
            Cancel
          </button>
          <button
            onClick={() => onChangeDoc(doc.id, { phase: "loading" })}
            className="rounded-md bg-blue-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-blue-500"
          >
            Continue
          </button>
        </div>
      </div>
    );
  }

  if (doc.phase === "loading") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3" style={{ color: "var(--m-muted)" }}>
        <Loader2 className="h-5 w-5 animate-spin opacity-60" />
        <span className="text-xs">Downloading &amp; preparing editor…</span>
      </div>
    );
  }

  if (doc.phase === "error") {
    return <div className="flex-1 p-4 text-sm text-red-500">{doc.error}</div>;
  }

  return (
    <div className="min-h-0 min-w-0 flex-1">
      <Editor
        height="100%"
        path={doc.id}
        // Panes can share a model; let the store dispose it when the tab closes.
        keepCurrentModel
        theme={theme}
        defaultLanguage={languageForFile(doc.name)}
        defaultValue={doc.original}
        onChange={(v) => onChangeDoc(doc.id, { text: v ?? "" })}
        onMount={onMount}
        loading={<div className="flex h-full items-center justify-center"><Loader2 className="h-5 w-5 animate-spin opacity-60" /></div>}
        options={{ ...options, readOnly: doc.sessionClosed }}
      />
    </div>
  );
}

function PaneButton({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      title={title}
      onClick={onClick}
      className="rounded border p-1 shadow"
      style={{ background: "var(--m-panel)", borderColor: "var(--m-border)", color: "var(--m-text)" }}
    >
      {children}
    </button>
  );
}

function Divider({ dir, onResize }: { dir: "row" | "col"; onResize: (delta: number, total: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const isRow = dir === "row";

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    const parent = ref.current?.parentElement;
    if (!parent) return;
    const rect = parent.getBoundingClientRect();
    const total = isRow ? rect.width : rect.height;
    const start = isRow ? e.clientX : e.clientY;

    const move = (ev: PointerEvent) => onResize((isRow ? ev.clientX : ev.clientY) - start, total);
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.style.removeProperty("cursor");
      document.body.style.removeProperty("user-select");
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    document.body.style.cursor = isRow ? "col-resize" : "row-resize";
    document.body.style.userSelect = "none";
  };

  return (
    <div
      ref={ref}
      onPointerDown={onPointerDown}
      className="relative z-20 shrink-0"
      style={{
        [isRow ? "width" : "height"]: "6px",
        cursor: isRow ? "col-resize" : "row-resize",
        background: "var(--m-border)",
      }}
    />
  );
}
