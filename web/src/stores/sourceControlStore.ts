import { create } from "zustand";
import { persistSettings } from "../lib/persist";
import type { ScStatus, ScDiffKind, ScAction } from "../lib/protocol";

export interface SelectedFile {
  path: string;
  kind: ScDiffKind;
}

export interface DiffData {
  diff: string;
  binary: boolean;
  truncated: boolean;
}

interface SourceControlState {
  panelOpen: boolean;
  panelWidth: number;
  statusByProject: Record<string, ScStatus | null>;
  selectedFile: SelectedFile | null;
  diffCache: Record<string, DiffData>;
  commitDrafts: Record<string, string>;
  expanded: { staged: boolean; changes: boolean; untracked: boolean; conflicted: boolean };
  lastActionError: string | null;
  pendingDiscard: { trackedFiles: string[]; untrackedFiles: string[] } | null;

  togglePanel: () => void;
  setPanelOpen: (open: boolean) => void;
  setPanelWidth: (w: number) => void;
  setStatus: (projectId: string, status: ScStatus | null) => void;
  selectFile: (file: SelectedFile | null) => void;
  setDiff: (key: string, data: DiffData) => void;
  setCommitDraft: (projectId: string, draft: string) => void;
  toggleGroup: (group: "staged" | "changes" | "untracked" | "conflicted") => void;
  setActionResult: (action: ScAction, ok: boolean, error?: string) => void;
  clearActionError: () => void;
  requestDiscard: (trackedFiles: string[], untrackedFiles: string[]) => void;
  cancelDiscard: () => void;
  hydrate: (panelOpen: boolean, panelWidth: number) => void;
}

export function diffCacheKey(projectId: string, file: string, kind: ScDiffKind): string {
  return `${projectId}::${kind}::${file}`;
}

const DIFF_CACHE_LIMIT = 20;

function pruneCache(cache: Record<string, DiffData>): Record<string, DiffData> {
  const keys = Object.keys(cache);
  if (keys.length <= DIFF_CACHE_LIMIT) return cache;
  // Object key insertion order ≈ FIFO; drop the oldest entries
  const drop = keys.length - DIFF_CACHE_LIMIT;
  const out: Record<string, DiffData> = {};
  for (let i = drop; i < keys.length; i++) {
    out[keys[i]] = cache[keys[i]];
  }
  return out;
}

function persist(get: () => SourceControlState) {
  const { panelOpen, panelWidth } = get();
  persistSettings({ ui: { sourceControlOpen: panelOpen, sourceControlWidth: panelWidth } });
}

export const useSourceControlStore = create<SourceControlState>((set, get) => ({
  panelOpen: false,
  panelWidth: 360,
  statusByProject: {},
  selectedFile: null,
  diffCache: {},
  commitDrafts: {},
  expanded: { staged: true, changes: true, untracked: true, conflicted: true },
  lastActionError: null,
  pendingDiscard: null,

  togglePanel: () => {
    set((s) => ({
      panelOpen: !s.panelOpen,
      // Free memory when closing
      diffCache: s.panelOpen ? {} : s.diffCache,
      selectedFile: s.panelOpen ? null : s.selectedFile,
    }));
    persist(get);
  },
  setPanelOpen: (open) => {
    set((s) => ({
      panelOpen: open,
      diffCache: open ? s.diffCache : {},
      selectedFile: open ? s.selectedFile : null,
    }));
    persist(get);
  },
  setPanelWidth: (w) => {
    const clamped = Math.min(800, Math.max(240, w));
    set({ panelWidth: clamped });
    persist(get);
  },
  setStatus: (projectId, status) => {
    set((s) => ({ statusByProject: { ...s.statusByProject, [projectId]: status } }));
  },
  selectFile: (file) => set({ selectedFile: file }),
  setDiff: (key, data) =>
    set((s) => {
      // Re-insert the key so it becomes the most recent on re-set
      const { [key]: _drop, ...rest } = s.diffCache;
      return { diffCache: pruneCache({ ...rest, [key]: data }) };
    }),
  setCommitDraft: (projectId, draft) =>
    set((s) => ({ commitDrafts: { ...s.commitDrafts, [projectId]: draft } })),
  toggleGroup: (group) =>
    set((s) => ({ expanded: { ...s.expanded, [group]: !s.expanded[group] } })),
  setActionResult: (action, ok, error) => {
    if (!ok && error) {
      set({ lastActionError: `${action}: ${error}` });
    } else if (ok && action === "commit") {
      // Clear draft on successful commit — done in the caller too,
      // but reset error here
      set({ lastActionError: null });
    } else {
      set({ lastActionError: null });
    }
  },
  clearActionError: () => set({ lastActionError: null }),
  requestDiscard: (trackedFiles, untrackedFiles) =>
    set({ pendingDiscard: { trackedFiles, untrackedFiles } }),
  cancelDiscard: () => set({ pendingDiscard: null }),
  hydrate: (panelOpen, panelWidth) => set({ panelOpen, panelWidth }),
}));

export async function hydrateSourceControlFromServer(): Promise<void> {
  try {
    const res = await fetch("/api/settings");
    const settings = await res.json();
    const ui = settings.ui ?? {};
    useSourceControlStore.getState().hydrate(
      ui.sourceControlOpen ?? false,
      ui.sourceControlWidth ?? 360,
    );
  } catch {
    // Server unavailable, keep defaults
  }
}
