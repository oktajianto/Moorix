import { Fragment, useRef } from "react";
import {
  SquareSplitHorizontal,
  SquareSplitVertical,
  X,
} from "lucide-react";
import { TerminalView } from "./TerminalView";
import { keyOf, MIN_PANE, type PaneNode } from "../paneTree";

type PaneActions = {
  activePaneId: string;
  onFocusPane: (id: string) => void;
  onSplit: (id: string, dir: "row" | "col") => void;
  onClosePane: (id: string) => void;
  /** Update the `sizes` of the split node at `path` (child-index steps). */
  onResize: (path: number[], sizes: number[]) => void;
};

/**
 * Renders a pane tree: each leaf is a live terminal, each split lays its
 * children out with a draggable divider between them. Recursive — `path`
 * identifies the current split node for resize callbacks.
 */
export function Panes({
  node,
  path = [],
  ...actions
}: { node: PaneNode; path?: number[] } & PaneActions) {
  if (node.type === "leaf") {
    const active = node.paneId === actions.activePaneId;
    return (
      <div
        onFocusCapture={() => actions.onFocusPane(node.paneId)}
        onPointerDownCapture={() => actions.onFocusPane(node.paneId)}
        className="group relative flex min-h-0 min-w-0 flex-1 overflow-hidden rounded"
        style={{
          outline: `1px solid ${active ? "var(--m-accent)" : "transparent"}`,
          outlineOffset: "-1px",
        }}
      >
        <div className="pointer-events-none absolute right-1.5 top-1.5 z-10 flex gap-0.5 opacity-0 transition group-hover:pointer-events-auto group-hover:opacity-100">
          <PaneButton
            title="Split right"
            onClick={() => actions.onSplit(node.paneId, "row")}
          >
            <SquareSplitHorizontal size={14} />
          </PaneButton>
          <PaneButton
            title="Split down"
            onClick={() => actions.onSplit(node.paneId, "col")}
          >
            <SquareSplitVertical size={14} />
          </PaneButton>
          <PaneButton
            title="Close pane"
            onClick={() => actions.onClosePane(node.paneId)}
          >
            <X size={14} />
          </PaneButton>
        </div>
        <TerminalView
          paneId={node.paneId}
          open={node.open}
          options={node.options}
        />
      </div>
    );
  }

  const isRow = node.dir === "row";
  return (
    <div
      className="flex min-h-0 min-w-0 flex-1"
      style={{ flexDirection: isRow ? "row" : "column" }}
    >
      {node.children.map((child, i) => (
        <Fragment key={keyOf(child)}>
          {i > 0 && (
            <Divider
              dir={node.dir}
              onResize={(delta, total) => {
                const df = delta / total;
                const a = node.sizes[i - 1];
                const b = node.sizes[i];
                const clamped = Math.max(-(a - MIN_PANE), Math.min(b - MIN_PANE, df));
                const next = node.sizes.slice();
                next[i - 1] = a + clamped;
                next[i] = b - clamped;
                actions.onResize(path, next);
              }}
            />
          )}
          <div
            className="flex min-h-0 min-w-0"
            style={{ flexGrow: node.sizes[i], flexBasis: 0 }}
          >
            <Panes node={child} path={[...path, i]} {...actions} />
          </div>
        </Fragment>
      ))}
    </div>
  );
}

function PaneButton({
  title,
  onClick,
  children,
}: {
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className="grid h-6 w-6 place-items-center rounded transition"
      style={{ background: "var(--m-panel)", color: "var(--m-muted)" }}
      onMouseEnter={(e) => (e.currentTarget.style.color = "var(--m-text)")}
      onMouseLeave={(e) => (e.currentTarget.style.color = "var(--m-muted)")}
    >
      {children}
    </button>
  );
}

/**
 * A draggable divider. Reports the pixel drag delta relative to the moment the
 * drag started, plus the parent's size along the split axis, so the parent can
 * convert it to a size fraction. Uses the whole start position each move (not
 * incremental) to avoid drift.
 */
function Divider({
  dir,
  onResize,
}: {
  dir: "row" | "col";
  onResize: (delta: number, total: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const isRow = dir === "row";

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    const parent = ref.current?.parentElement;
    if (!parent) return;
    const rect = parent.getBoundingClientRect();
    const total = isRow ? rect.width : rect.height;
    const start = isRow ? e.clientX : e.clientY;

    const move = (ev: PointerEvent) => {
      const pos = isRow ? ev.clientX : ev.clientY;
      onResize(pos - start, total);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.style.removeProperty("cursor");
      document.body.style.removeProperty("user-select");
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    // Keep the resize cursor and suppress text selection for the whole drag.
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
