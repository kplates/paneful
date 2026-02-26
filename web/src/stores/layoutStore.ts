import { create } from 'zustand';
import {
  LayoutNode,
  addPane,
  removePane,
  resizeSplit,
  swapPanes,
  movePaneTo,
  applyPreset,
  getTerminalIds,
  Edge,
  Direction,
  PresetName,
  PRESET_NAMES,
} from '../lib/layout-engine';

interface LayoutState {
  // Layout tree per project
  layouts: Record<string, LayoutNode | null>;
  currentPresetIndex: number;

  getLayout: (projectId: string) => LayoutNode | null;
  setLayout: (projectId: string, layout: LayoutNode | null) => void;

  addPaneToProject: (projectId: string, focusedId: string, newTerminalId: string, direction?: Direction) => void;
  removePaneFromProject: (projectId: string, terminalId: string) => void;
  resizePaneInProject: (projectId: string, path: number[], newRatio: number) => void;
  swapPanesInProject: (projectId: string, idA: string, idB: string) => void;
  movePaneInProject: (projectId: string, sourceId: string, targetId: string, edge: Edge) => void;
  applyPresetToProject: (projectId: string, terminalIds: string[]) => void;
  cyclePreset: (projectId: string, terminalIds: string[]) => void;
  removeProjectLayout: (projectId: string) => void;
}

export const useLayoutStore = create<LayoutState>((set, get) => ({
  layouts: {},
  currentPresetIndex: 0,

  getLayout: (projectId) => get().layouts[projectId] ?? null,

  setLayout: (projectId, layout) =>
    set((s) => ({
      layouts: { ...s.layouts, [projectId]: layout },
    })),

  addPaneToProject: (projectId, focusedId, newTerminalId, direction) =>
    set((s) => {
      const current = s.layouts[projectId] ?? null;
      const updated = addPane(current, focusedId, newTerminalId, direction);
      return { layouts: { ...s.layouts, [projectId]: updated } };
    }),

  removePaneFromProject: (projectId, terminalId) =>
    set((s) => {
      const current = s.layouts[projectId];
      if (!current) return s;
      const updated = removePane(current, terminalId);
      return { layouts: { ...s.layouts, [projectId]: updated } };
    }),

  resizePaneInProject: (projectId, path, newRatio) =>
    set((s) => {
      const current = s.layouts[projectId];
      if (!current) return s;
      const updated = resizeSplit(current, path, newRatio);
      return { layouts: { ...s.layouts, [projectId]: updated } };
    }),

  swapPanesInProject: (projectId, idA, idB) =>
    set((s) => {
      const current = s.layouts[projectId];
      if (!current) return s;
      const updated = swapPanes(current, idA, idB);
      return { layouts: { ...s.layouts, [projectId]: updated } };
    }),

  movePaneInProject: (projectId, sourceId, targetId, edge) =>
    set((s) => {
      const current = s.layouts[projectId];
      if (!current) return s;
      const updated = movePaneTo(current, sourceId, targetId, edge);
      return { layouts: { ...s.layouts, [projectId]: updated } };
    }),

  applyPresetToProject: (projectId, terminalIds) =>
    set((s) => {
      const preset = PRESET_NAMES[s.currentPresetIndex];
      const layout = applyPreset(terminalIds, preset);
      return { layouts: { ...s.layouts, [projectId]: layout } };
    }),

  cyclePreset: (projectId, terminalIds) =>
    set((s) => {
      const nextIndex = (s.currentPresetIndex + 1) % PRESET_NAMES.length;
      const preset = PRESET_NAMES[nextIndex];
      const layout = applyPreset(terminalIds, preset);
      return {
        currentPresetIndex: nextIndex,
        layouts: { ...s.layouts, [projectId]: layout },
      };
    }),

  removeProjectLayout: (projectId) =>
    set((s) => {
      const { [projectId]: _, ...rest } = s.layouts;
      return { layouts: rest };
    }),
}));
