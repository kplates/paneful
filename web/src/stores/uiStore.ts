import { create } from 'zustand';

export type ThemePreference = 'system' | 'dark' | 'light';

function applyThemeAttribute(theme: ThemePreference) {
  document.documentElement.setAttribute('data-theme', theme);
}

export function getResolvedTheme(pref: ThemePreference): 'dark' | 'light' {
  if (pref === 'system') {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  return pref;
}

interface UIState {
  focusedTerminalId: string | null;
  sidebarOpen: boolean;
  sidebarWidth: number;
  draggingTerminalId: string | null;
  dropTarget: { terminalId: string; edge: string } | null;
  connectionStatus: 'connecting' | 'connected' | 'disconnected';
  editorSyncEnabled: boolean;
  theme: ThemePreference;

  setFocusedTerminal: (id: string | null) => void;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  setSidebarWidth: (w: number) => void;
  setDragging: (id: string | null) => void;
  setDropTarget: (target: { terminalId: string; edge: string } | null) => void;
  setConnectionStatus: (status: 'connecting' | 'connected' | 'disconnected') => void;
  toggleEditorSync: () => void;
  setTheme: (theme: ThemePreference) => void;
  cycleTheme: () => void;
}

const initialTheme = (localStorage.getItem('paneful:theme') as ThemePreference) || 'system';
applyThemeAttribute(initialTheme);

export const useUIStore = create<UIState>((set, get) => ({
  focusedTerminalId: null,
  sidebarOpen: true,
  sidebarWidth: Number(localStorage.getItem('paneful:sidebar-width')) || 224,
  draggingTerminalId: null,
  dropTarget: null,
  connectionStatus: 'connecting',
  editorSyncEnabled: localStorage.getItem('paneful:editor-sync') !== '0',
  theme: initialTheme,

  setFocusedTerminal: (id) => set({ focusedTerminalId: id }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  setSidebarWidth: (w) => {
    const clamped = Math.min(400, Math.max(160, w));
    localStorage.setItem('paneful:sidebar-width', String(clamped));
    set({ sidebarWidth: clamped });
  },
  setDragging: (id) => set({ draggingTerminalId: id }),
  setDropTarget: (target) => set({ dropTarget: target }),
  setConnectionStatus: (status) => set({ connectionStatus: status }),
  toggleEditorSync: () => set((s) => {
    const next = !s.editorSyncEnabled;
    localStorage.setItem('paneful:editor-sync', next ? '1' : '0');
    return { editorSyncEnabled: next };
  }),
  setTheme: (theme) => {
    localStorage.setItem('paneful:theme', theme);
    applyThemeAttribute(theme);
    set({ theme });
  },
  cycleTheme: () => {
    const order: ThemePreference[] = ['system', 'light', 'dark'];
    const current = get().theme;
    const next = order[(order.indexOf(current) + 1) % order.length];
    localStorage.setItem('paneful:theme', next);
    applyThemeAttribute(next);
    set({ theme: next });
  },
}));
