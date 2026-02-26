import { create } from 'zustand';

interface UIState {
  focusedTerminalId: string | null;
  sidebarOpen: boolean;
  draggingTerminalId: string | null;
  dropTarget: { terminalId: string; edge: string } | null;
  connectionStatus: 'connecting' | 'connected' | 'disconnected';

  setFocusedTerminal: (id: string | null) => void;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  setDragging: (id: string | null) => void;
  setDropTarget: (target: { terminalId: string; edge: string } | null) => void;
  setConnectionStatus: (status: 'connecting' | 'connected' | 'disconnected') => void;
}

export const useUIStore = create<UIState>((set) => ({
  focusedTerminalId: null,
  sidebarOpen: true,
  draggingTerminalId: null,
  dropTarget: null,
  connectionStatus: 'connecting',

  setFocusedTerminal: (id) => set({ focusedTerminalId: id }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  setDragging: (id) => set({ draggingTerminalId: id }),
  setDropTarget: (target) => set({ dropTarget: target }),
  setConnectionStatus: (status) => set({ connectionStatus: status }),
}));
