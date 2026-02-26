import { MIN_PANE_RATIO, MAX_PANE_RATIO } from './constants';

export type Direction = 'horizontal' | 'vertical';

export type LayoutNode =
  | { type: 'leaf'; terminalId: string }
  | {
      type: 'split';
      direction: Direction;
      ratio: number;
      first: LayoutNode;
      second: LayoutNode;
    };

// Get all terminal IDs in order (depth-first, left-to-right)
export function getTerminalIds(tree: LayoutNode | null): string[] {
  if (!tree) return [];
  if (tree.type === 'leaf') return [tree.terminalId];
  return [...getTerminalIds(tree.first), ...getTerminalIds(tree.second)];
}

// Count leaves
export function countLeaves(tree: LayoutNode | null): number {
  if (!tree) return 0;
  if (tree.type === 'leaf') return 1;
  return countLeaves(tree.first) + countLeaves(tree.second);
}

// Find the direction of the parent split containing a terminal
function findParentDirection(tree: LayoutNode, terminalId: string): Direction | null {
  if (tree.type === 'leaf') return null;
  const ids1 = getTerminalIds(tree.first);
  const ids2 = getTerminalIds(tree.second);
  if (ids1.includes(terminalId) || ids2.includes(terminalId)) {
    return tree.direction;
  }
  return findParentDirection(tree.first, terminalId) ?? findParentDirection(tree.second, terminalId);
}

// Add a new pane by splitting the focused pane
export function addPane(
  tree: LayoutNode | null,
  focusedId: string,
  newTerminalId: string,
  direction?: Direction
): LayoutNode {
  if (!tree) {
    return { type: 'leaf', terminalId: newTerminalId };
  }

  // Determine direction: alternate from parent, or use provided
  const resolvedDirection =
    direction ?? (findParentDirection(tree, focusedId) === 'vertical' ? 'horizontal' : 'vertical');

  return addPaneInner(tree, focusedId, newTerminalId, resolvedDirection);
}

function addPaneInner(
  node: LayoutNode,
  focusedId: string,
  newTerminalId: string,
  direction: Direction
): LayoutNode {
  if (node.type === 'leaf') {
    if (node.terminalId === focusedId) {
      return {
        type: 'split',
        direction,
        ratio: 0.5,
        first: node,
        second: { type: 'leaf', terminalId: newTerminalId },
      };
    }
    return node;
  }

  return {
    ...node,
    first: addPaneInner(node.first, focusedId, newTerminalId, direction),
    second: addPaneInner(node.second, focusedId, newTerminalId, direction),
  };
}

// Remove a pane — the sibling fills the gap
export function removePane(tree: LayoutNode | null, terminalId: string): LayoutNode | null {
  if (!tree) return null;
  if (tree.type === 'leaf') {
    return tree.terminalId === terminalId ? null : tree;
  }

  const firstIds = getTerminalIds(tree.first);
  const secondIds = getTerminalIds(tree.second);

  if (tree.first.type === 'leaf' && tree.first.terminalId === terminalId) {
    return tree.second;
  }
  if (tree.second.type === 'leaf' && tree.second.terminalId === terminalId) {
    return tree.first;
  }

  if (firstIds.includes(terminalId)) {
    const newFirst = removePane(tree.first, terminalId);
    if (!newFirst) return tree.second;
    return { ...tree, first: newFirst };
  }

  if (secondIds.includes(terminalId)) {
    const newSecond = removePane(tree.second, terminalId);
    if (!newSecond) return tree.first;
    return { ...tree, second: newSecond };
  }

  return tree;
}

// Resize a split node at a given path
export function resizeSplit(
  tree: LayoutNode,
  path: number[],
  newRatio: number
): LayoutNode {
  const clamped = Math.max(MIN_PANE_RATIO, Math.min(MAX_PANE_RATIO, newRatio));

  if (path.length === 0) {
    if (tree.type === 'split') {
      return { ...tree, ratio: clamped };
    }
    return tree;
  }

  if (tree.type === 'leaf') return tree;

  const [head, ...rest] = path;
  if (head === 0) {
    return { ...tree, first: resizeSplit(tree.first, rest, clamped) };
  } else {
    return { ...tree, second: resizeSplit(tree.second, rest, clamped) };
  }
}

// Swap two panes' terminal IDs
export function swapPanes(tree: LayoutNode, idA: string, idB: string): LayoutNode {
  if (tree.type === 'leaf') {
    if (tree.terminalId === idA) return { ...tree, terminalId: idB };
    if (tree.terminalId === idB) return { ...tree, terminalId: idA };
    return tree;
  }

  return {
    ...tree,
    first: swapPanes(tree.first, idA, idB),
    second: swapPanes(tree.second, idA, idB),
  };
}

// Move a pane to a new location relative to a target
export type Edge = 'left' | 'right' | 'top' | 'bottom';

export function movePaneTo(
  tree: LayoutNode,
  sourceId: string,
  targetId: string,
  edge: Edge
): LayoutNode | null {
  // Remove source first
  const treeWithoutSource = removePane(tree, sourceId);
  if (!treeWithoutSource) return null;

  // Now insert next to target
  const direction: Direction = edge === 'left' || edge === 'right' ? 'vertical' : 'horizontal';
  const sourceFirst = edge === 'left' || edge === 'top';

  return insertNextTo(treeWithoutSource, targetId, sourceId, direction, sourceFirst);
}

function insertNextTo(
  node: LayoutNode,
  targetId: string,
  sourceId: string,
  direction: Direction,
  sourceFirst: boolean
): LayoutNode {
  if (node.type === 'leaf') {
    if (node.terminalId === targetId) {
      const sourceLeaf: LayoutNode = { type: 'leaf', terminalId: sourceId };
      return {
        type: 'split',
        direction,
        ratio: 0.5,
        first: sourceFirst ? sourceLeaf : node,
        second: sourceFirst ? node : sourceLeaf,
      };
    }
    return node;
  }

  return {
    ...node,
    first: insertNextTo(node.first, targetId, sourceId, direction, sourceFirst),
    second: insertNextTo(node.second, targetId, sourceId, direction, sourceFirst),
  };
}

// ── Presets ──

export type PresetName = 'even-horizontal' | 'even-vertical' | 'main-left' | 'main-top' | 'grid';

export const PRESET_NAMES: PresetName[] = ['even-horizontal', 'even-vertical', 'main-left', 'main-top', 'grid'];

export function applyPreset(terminalIds: string[], preset: PresetName): LayoutNode | null {
  if (terminalIds.length === 0) return null;
  if (terminalIds.length === 1) return { type: 'leaf', terminalId: terminalIds[0] };

  switch (preset) {
    case 'even-horizontal':
      return buildEvenChain(terminalIds, 'horizontal');
    case 'even-vertical':
      return buildEvenChain(terminalIds, 'vertical');
    case 'main-left':
      return buildMainSide(terminalIds, 'vertical', true);
    case 'main-top':
      return buildMainSide(terminalIds, 'horizontal', true);
    case 'grid':
      return buildGrid(terminalIds);
  }
}

function buildEvenChain(ids: string[], direction: Direction): LayoutNode {
  if (ids.length === 1) return { type: 'leaf', terminalId: ids[0] };
  if (ids.length === 2) {
    return {
      type: 'split',
      direction,
      ratio: 0.5,
      first: { type: 'leaf', terminalId: ids[0] },
      second: { type: 'leaf', terminalId: ids[1] },
    };
  }

  const ratio = 1 / ids.length;
  return {
    type: 'split',
    direction,
    ratio,
    first: { type: 'leaf', terminalId: ids[0] },
    second: buildEvenChain(ids.slice(1), direction),
  };
}

function buildMainSide(
  ids: string[],
  direction: Direction,
  mainFirst: boolean
): LayoutNode {
  const [main, ...rest] = ids;
  const stackDir: Direction = direction === 'vertical' ? 'horizontal' : 'vertical';
  const stack = buildEvenChain(rest, stackDir);
  const mainLeaf: LayoutNode = { type: 'leaf', terminalId: main };

  return {
    type: 'split',
    direction,
    ratio: 0.6,
    first: mainFirst ? mainLeaf : stack,
    second: mainFirst ? stack : mainLeaf,
  };
}

function buildGrid(ids: string[]): LayoutNode {
  if (ids.length <= 2) return buildEvenChain(ids, 'vertical');

  const mid = Math.ceil(ids.length / 2);
  const topIds = ids.slice(0, mid);
  const bottomIds = ids.slice(mid);

  return {
    type: 'split',
    direction: 'horizontal',
    ratio: 0.5,
    first: buildEvenChain(topIds, 'vertical'),
    second: bottomIds.length > 0
      ? buildEvenChain(bottomIds, 'vertical')
      : { type: 'leaf', terminalId: topIds[topIds.length - 1] },
  };
}

// Find the path to a split node that directly contains a leaf with the given ID
export function findSplitPath(tree: LayoutNode, terminalId: string, path: number[] = []): number[] | null {
  if (tree.type === 'leaf') return null;

  if (
    (tree.first.type === 'leaf' && tree.first.terminalId === terminalId) ||
    (tree.second.type === 'leaf' && tree.second.terminalId === terminalId)
  ) {
    return path;
  }

  return (
    findSplitPath(tree.first, terminalId, [...path, 0]) ??
    findSplitPath(tree.second, terminalId, [...path, 1])
  );
}

// Get adjacent terminal in a given direction
export function getAdjacentTerminal(
  tree: LayoutNode,
  currentId: string,
  direction: 'left' | 'right' | 'up' | 'down'
): string | null {
  const ids = getTerminalIds(tree);
  const idx = ids.indexOf(currentId);
  if (idx === -1) return null;

  // Simplified: just go prev/next in the flat order
  if (direction === 'left' || direction === 'up') {
    return idx > 0 ? ids[idx - 1] : null;
  }
  return idx < ids.length - 1 ? ids[idx + 1] : null;
}
