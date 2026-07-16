import type { OpenSession, TermOptions } from "./components/TerminalView";
import type { TabDesc } from "./profiles";

/**
 * A terminal tab holds a tree of panes. A leaf is one live terminal session; a
 * split arranges its children side by side ("row") or stacked ("col") with
 * user-draggable dividers. `sizes` are fractions that sum to ~1, one per child.
 */
export type PaneLeaf = {
  type: "leaf";
  paneId: string;
  label: string;
  open: OpenSession;
  options?: TermOptions;
  desc?: TabDesc; // added for persistence
};

export type PaneNodeDesc =
  | { type: "leaf"; desc?: TabDesc }
  | { type: "split"; dir: "row" | "col"; sizes: number[]; children: PaneNodeDesc[] };

export type PaneSplit = {
  type: "split";
  dir: "row" | "col";
  sizes: number[];
  children: PaneNode[];
};

export type PaneNode = PaneLeaf | PaneSplit;

/** Minimum fraction a pane may be shrunk to while dragging a divider. */
export const MIN_PANE = 0.08;

let paneCounter = 1;
export const nextPaneId = () => `pane-${paneCounter++}`;

export const makeLeaf = (
  label: string,
  open: OpenSession,
  options?: TermOptions,
  desc?: TabDesc,
): PaneLeaf => ({ type: "leaf", paneId: nextPaneId(), label, open, options, desc });

/** A stable React key for a node (its own paneId, or its first leaf's). */
export function keyOf(node: PaneNode): string {
  return node.type === "leaf" ? node.paneId : `s-${firstLeaf(node).paneId}`;
}

export function firstLeaf(node: PaneNode): PaneLeaf {
  return node.type === "leaf" ? node : firstLeaf(node.children[0]);
}

export function findLeaf(node: PaneNode, paneId: string): PaneLeaf | null {
  if (node.type === "leaf") return node.paneId === paneId ? node : null;
  for (const c of node.children) {
    const found = findLeaf(c, paneId);
    if (found) return found;
  }
  return null;
}

export function leafCount(node: PaneNode): number {
  return node.type === "leaf"
    ? 1
    : node.children.reduce((n, c) => n + leafCount(c), 0);
}

/** Every leaf in the tree (used to dispose sessions when a tab closes). */
export function allLeaves(node: PaneNode): PaneLeaf[] {
  return node.type === "leaf" ? [node] : node.children.flatMap(allLeaves);
}

/**
 * Split the leaf `targetId` in two: it becomes a split (of `dir`) holding the
 * original leaf and `newLeaf`, evenly sized. Returns a new tree.
 */
export function splitLeaf(
  node: PaneNode,
  targetId: string,
  dir: "row" | "col",
  newLeaf: PaneLeaf,
): PaneNode {
  if (node.type === "leaf") {
    if (node.paneId !== targetId) return node;
    return { type: "split", dir, sizes: [0.5, 0.5], children: [node, newLeaf] };
  }
  return {
    ...node,
    children: node.children.map((c) => splitLeaf(c, targetId, dir, newLeaf)),
  };
}

/**
 * Remove the leaf `targetId`. A split left with a single child collapses into
 * that child; remaining siblings keep their proportions (renormalised). Returns
 * null if the whole tree becomes empty (i.e. the last pane was closed).
 */
export function closeLeaf(node: PaneNode, targetId: string): PaneNode | null {
  if (node.type === "leaf") return node.paneId === targetId ? null : node;

  const kept: { child: PaneNode; size: number }[] = [];
  node.children.forEach((c, i) => {
    const r = closeLeaf(c, targetId);
    if (r) kept.push({ child: r, size: node.sizes[i] });
  });

  if (kept.length === 0) return null;
  if (kept.length === 1) return kept[0].child;

  const total = kept.reduce((s, k) => s + k.size, 0);
  return {
    ...node,
    children: kept.map((k) => k.child),
    sizes: kept.map((k) => k.size / total),
  };
}

/** Replace the `sizes` of the split node at `path` (child-index steps from root). */
export function setSizesAtPath(
  node: PaneNode,
  path: number[],
  sizes: number[],
): PaneNode {
  if (path.length === 0) {
    return node.type === "split" ? { ...node, sizes } : node;
  }
  if (node.type !== "split") return node;
  const [i, ...rest] = path;
  return {
    ...node,
    children: node.children.map((c, idx) =>
      idx === i ? setSizesAtPath(c, rest, sizes) : c,
    ),
  };
}

export function serializePaneNode(node: PaneNode): PaneNodeDesc | null {
  if (node.type === "leaf") {
    if (!node.desc) return null;
    return { type: "leaf", desc: node.desc };
  }
  const children = node.children.map(serializePaneNode).filter((c): c is PaneNodeDesc => c !== null);
  if (children.length === 0) return null;
  if (children.length === 1) return children[0];

  // Re-normalize sizes in case some children failed to serialize
  const validIndices = node.children.map((_, i) => serializePaneNode(node.children[i]) !== null);
  const validSizes = node.sizes.filter((_, i) => validIndices[i]);
  const total = validSizes.reduce((a, b) => a + b, 0);
  const sizes = validSizes.map((s) => s / (total || 1));

  return { type: "split", dir: node.dir, sizes, children };
}
