/**
 * Pane tree for the editor's split view. A leaf shows one open document; a
 * split arranges its children side by side ("row") or stacked ("col") with
 * draggable dividers. `sizes` are fractions summing to ~1, one per child.
 *
 * These are the same algorithms the terminal panes use (`paneTree.ts`), kept
 * separate because that module's leaf carries a live terminal session. Keeping
 * them apart avoids destabilising working terminal code; the two can be unified
 * behind a generic leaf type later if it ever earns its keep.
 */

export type EditorLeaf = {
  type: "leaf";
  paneId: string;
  /** Which open document this pane displays; null when nothing is open. */
  docId: string | null;
};

export type EditorSplit = {
  type: "split";
  dir: "row" | "col";
  sizes: number[];
  children: EditorNode[];
};

export type EditorNode = EditorLeaf | EditorSplit;

/** Minimum fraction a pane may be shrunk to while dragging a divider. */
export const MIN_PANE = 0.08;

let counter = 1;
export const nextPaneId = () => `epane-${counter++}`;

export const makeLeaf = (docId: string | null): EditorLeaf => ({
  type: "leaf",
  paneId: nextPaneId(),
  docId,
});

/** A stable React key for a node (its own paneId, or its first leaf's). */
export const keyOf = (node: EditorNode): string =>
  node.type === "leaf" ? node.paneId : `s-${firstLeaf(node).paneId}`;

export function firstLeaf(node: EditorNode): EditorLeaf {
  return node.type === "leaf" ? node : firstLeaf(node.children[0]);
}

export function findLeaf(node: EditorNode, paneId: string): EditorLeaf | null {
  if (node.type === "leaf") return node.paneId === paneId ? node : null;
  for (const c of node.children) {
    const found = findLeaf(c, paneId);
    if (found) return found;
  }
  return null;
}

export function leafCount(node: EditorNode): number {
  return node.type === "leaf" ? 1 : node.children.reduce((n, c) => n + leafCount(c), 0);
}

export function allLeaves(node: EditorNode): EditorLeaf[] {
  return node.type === "leaf" ? [node] : node.children.flatMap(allLeaves);
}

/** Rewrite every leaf through `fn`, preserving the tree shape. */
export function mapLeaves(node: EditorNode, fn: (l: EditorLeaf) => EditorLeaf): EditorNode {
  return node.type === "leaf"
    ? fn(node)
    : { ...node, children: node.children.map((c) => mapLeaves(c, fn)) };
}

/** Point one pane at a different document. */
export const setPaneDoc = (node: EditorNode, paneId: string, docId: string | null): EditorNode =>
  mapLeaves(node, (l) => (l.paneId === paneId ? { ...l, docId } : l));

/**
 * Split the leaf `targetId` in two: it becomes a split (of `dir`) holding the
 * original leaf and `newLeaf`, evenly sized. Returns a new tree.
 */
export function splitLeaf(
  node: EditorNode,
  targetId: string,
  dir: "row" | "col",
  newLeaf: EditorLeaf,
): EditorNode {
  if (node.type === "leaf") {
    if (node.paneId !== targetId) return node;
    return { type: "split", dir, sizes: [0.5, 0.5], children: [node, newLeaf] };
  }
  return { ...node, children: node.children.map((c) => splitLeaf(c, targetId, dir, newLeaf)) };
}

/**
 * Remove the leaf `targetId`. A split left with a single child collapses into
 * that child; remaining siblings keep their proportions (renormalised). Returns
 * null once the tree is empty.
 */
export function closeLeaf(node: EditorNode, targetId: string): EditorNode | null {
  if (node.type === "leaf") return node.paneId === targetId ? null : node;

  const kept: { child: EditorNode; size: number }[] = [];
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
export function setSizesAtPath(node: EditorNode, path: number[], sizes: number[]): EditorNode {
  if (path.length === 0) return node.type === "split" ? { ...node, sizes } : node;
  if (node.type !== "split") return node;
  const [i, ...rest] = path;
  return {
    ...node,
    children: node.children.map((c, idx) => (idx === i ? setSizesAtPath(c, rest, sizes) : c)),
  };
}
