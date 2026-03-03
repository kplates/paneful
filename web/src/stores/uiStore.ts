import { create } from 'zustand';
import { persistSettings } from '../lib/persist';

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
  syncToast: { projectName: string; id: number } | null;

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
  showSyncToast: (projectName: string) => void;
  dismissSyncToast: () => void;
  hydrateFromServer: () => Promise<void>;
}

// Fast-render cache: read theme from localStorage to prevent flash
const initialTheme = (localStorage.getItem('paneful:theme') as ThemePreference) || 'system';
applyThemeAttribute(initialTheme);

function persistUI(get: () => UIState) {
  const { theme, sidebarWidth, editorSyncEnabled } = get();
  persistSettings({ ui: { theme, sidebarWidth, editorSyncEnabled } });
}

export const useUIStore = create<UIState>((set, get) => ({
  focusedTerminalId: null,
  sidebarOpen: true,
  sidebarWidth: 224,
  draggingTerminalId: null,
  dropTarget: null,
  connectionStatus: 'connecting',
  editorSyncEnabled: true,
  theme: initialTheme,
  syncToast: null,

  setFocusedTerminal: (id) => set({ focusedTerminalId: id }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  setSidebarWidth: (w) => {
    const clamped = Math.min(400, Math.max(160, w));
    set({ sidebarWidth: clamped });
    persistUI(get);
  },
  setDragging: (id) => set({ draggingTerminalId: id }),
  setDropTarget: (target) => set({ dropTarget: target }),
  setConnectionStatus: (status) => set({ connectionStatus: status }),
  toggleEditorSync: () => {
    set((s) => ({ editorSyncEnabled: !s.editorSyncEnabled }));
    persistUI(get);
  },
  setTheme: (theme) => {
    localStorage.setItem('paneful:theme', theme);
    applyThemeAttribute(theme);
    set({ theme });
    persistUI(get);
  },
  cycleTheme: () => {
    const order: ThemePreference[] = ['system', 'light', 'dark'];
    const current = get().theme;
    const next = order[(order.indexOf(current) + 1) % order.length];
    localStorage.setItem('paneful:theme', next);
    applyThemeAttribute(next);
    set({ theme: next });
    persistUI(get);
  },

  showSyncToast: (projectName) => {
    set({ syncToast: { projectName, id: Date.now() } });
  },
  dismissSyncToast: () => set({ syncToast: null }),

  hydrateFromServer: async () => {
    try {
      const res = await fetch('/api/settings');
      const settings = await res.json();
      if (settings.ui) {
        const { theme, sidebarWidth, editorSyncEnabled } = settings.ui;
        if (theme) {
          localStorage.setItem('paneful:theme', theme);
          applyThemeAttribute(theme);
        }
        set({
          ...(theme ? { theme } : {}),
          ...(sidebarWidth !== undefined ? { sidebarWidth } : {}),
          ...(editorSyncEnabled !== undefined ? { editorSyncEnabled } : {}),
        });
      }
    } catch {
      // Server unavailable, keep defaults
    }
  },
}));
