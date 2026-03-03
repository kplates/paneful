import { useEffect } from 'react';
import { useUIStore } from '../stores/uiStore';
import { useLayoutStore } from '../stores/layoutStore';
import { useProjectStore } from '../stores/projectStore';
import { useSessionStore } from '../stores/sessionStore';
import { sendMessage } from './useWebSocket';
import { cleanupTerminal } from './useTerminal';
import { getTerminalIds, getAdjacentTerminal, applyPreset } from '../lib/layout-engine';
import type { PresetName } from '../lib/layout-engine';

// Keys we need to hijack from the browser — must preventDefault in capture phase
// BEFORE the browser's default handler fires
const HIJACKED_KEYS = new Set(['n', 'w', 't', 'd', 'r', 'f', 'p']);

export function useKeyboardShortcuts() {
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);
  const setFocusedTerminal = useUIStore((s) => s.setFocusedTerminal);

  useEffect(() => {
    // Capture phase handler — runs before the browser processes the shortcut
    const handler = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();

      // Ctrl+Shift+Arrow: move focus to adjacent pane
      if (e.ctrlKey && e.shiftKey && !e.metaKey && !e.altKey && ['arrowleft', 'arrowright', 'arrowup', 'arrowdown'].includes(key)) {
        e.preventDefault();
        e.stopPropagation();
        const activeProjectId = useProjectStore.getState().activeProjectId;
        if (!activeProjectId) return;
        const layout = useLayoutStore.getState().getLayout(activeProjectId);
        const focusedId = useUIStore.getState().focusedTerminalId;
        if (!focusedId || !layout) return;
        const dir = key === 'arrowleft' ? 'left' : key === 'arrowright' ? 'right' : key === 'arrowup' ? 'up' : 'down';
        const adjacent = getAdjacentTerminal(layout, focusedId, dir as 'left' | 'right' | 'up' | 'down');
        if (adjacent) {
          setFocusedTerminal(adjacent);
          const session = useSessionStore.getState().sessions[adjacent];
          session?.terminal?.focus();
        }
        return;
      }

      // Shift+Arrow: swap focused pane with adjacent
      if (e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && ['arrowleft', 'arrowright', 'arrowup', 'arrowdown'].includes(key)) {
        e.preventDefault();
        e.stopPropagation();
        const activeProjectId = useProjectStore.getState().activeProjectId;
        if (!activeProjectId) return;
        const layout = useLayoutStore.getState().getLayout(activeProjectId);
        const focusedId = useUIStore.getState().focusedTerminalId;
        if (!focusedId || !layout) return;
        const dir = key === 'arrowleft' ? 'left' : key === 'arrowright' ? 'right' : key === 'arrowup' ? 'up' : 'down';
        const adjacent = getAdjacentTerminal(layout, focusedId, dir as 'left' | 'right' | 'up' | 'down');
        if (adjacent) {
          useLayoutStore.getState().swapPanesInProject(activeProjectId, focusedId, adjacent);
        }
        return;
      }

      const isMac = navigator.platform.startsWith('Mac');
      const meta = isMac ? e.metaKey : e.ctrlKey;
      if (!meta) return;

      // Cmd+=/-/0: CSS zoom for native app (WKWebView has no built-in browser zoom).
      // In regular browsers (Chrome, Safari, etc.) we let native zoom handle it.
      if ((key === '=' || key === '+' || key === '-' || key === '0') && !e.shiftKey) {
        const isNativeApp = !('chrome' in window) && /AppleWebKit/.test(navigator.userAgent) && !(/Safari/.test(navigator.userAgent));
        if (isNativeApp) {
          e.preventDefault();
          e.stopPropagation();
          const current = parseFloat(document.documentElement.style.zoom || '1');
          if (key === '=' || key === '+') {
            document.documentElement.style.zoom = String(Math.min(current + 0.1, 2));
          } else if (key === '-') {
            document.documentElement.style.zoom = String(Math.max(current - 0.1, 0.5));
          } else {
            document.documentElement.style.zoom = '1';
          }
          // Trigger resize so xterm.js terminals refit
          window.dispatchEvent(new Event('resize'));
          return;
        }
        // In browsers: don't intercept — let native zoom work
      }

      // Immediately block browser defaults for our shortcuts
      // This must happen BEFORE any early returns, otherwise the browser
      // will open a new window (Cmd+N), close the tab (Cmd+W), etc.
      if (HIJACKED_KEYS.has(key) || (key >= '1' && key <= '9')) {
        e.preventDefault();
        e.stopPropagation();
      }

      const activeProjectId = useProjectStore.getState().activeProjectId;
      if (!activeProjectId) return;

      const layout = useLayoutStore.getState().getLayout(activeProjectId);
      const focusedId = useUIStore.getState().focusedTerminalId;
      const project = useProjectStore.getState().projects[activeProjectId];

      // Cmd+P: toggle command palette
      if (key === 'p' && !e.shiftKey) {
        useUIStore.getState().toggleCommandPalette();
        return;
      }

      // Cmd+F: open search in focused terminal
      if (key === 'f' && !e.shiftKey) {
        if (focusedId) {
          useUIStore.getState().openSearch(focusedId);
        }
        return;
      }

      // Cmd+D: toggle sidebar
      if (key === 'd' && !e.shiftKey) {
        toggleSidebar();
        return;
      }

      // Cmd+N: new terminal
      if (key === 'n') {
        if (!project) return;
        const newId = crypto.randomUUID();
        const ids = getTerminalIds(layout);
        if (ids.length > 0) {
          // Add next to focused (or last) pane
          const refId = focusedId ?? ids[ids.length - 1];
          const dir = e.shiftKey ? 'horizontal' : 'vertical';
          useLayoutStore.getState().addPaneToProject(activeProjectId, refId, newId, dir);
        } else {
          useLayoutStore.getState().setLayout(activeProjectId, { type: 'leaf', terminalId: newId });
        }
        useProjectStore.getState().addTerminalToProject(activeProjectId, newId);
        setFocusedTerminal(newId);
        return;
      }

      // Cmd+W: close pane
      if (key === 'w' && !e.shiftKey) {
        if (!focusedId || !layout) return;
        sendMessage({ type: 'pty:kill', terminalId: focusedId });
        useLayoutStore.getState().removePaneFromProject(activeProjectId, focusedId);
        useProjectStore.getState().removeTerminalFromProject(activeProjectId, focusedId);
        const session = useSessionStore.getState().sessions[focusedId];
        session?.terminal?.dispose();
        useSessionStore.getState().removeSession(focusedId);
        cleanupTerminal(focusedId);
        const remaining = getTerminalIds(
          useLayoutStore.getState().getLayout(activeProjectId)
        );
        setFocusedTerminal(remaining[0] ?? null);
        return;
      }

      // Cmd+T: cycle layout preset
      if (key === 't' && !e.shiftKey) {
        if (!project) return;
        const ids = getTerminalIds(layout);
        if (ids.length > 0) {
          useLayoutStore.getState().cyclePreset(activeProjectId, ids);
        }
        return;
      }

      // Cmd+R: auto reorganize
      if (key === 'r' && !e.shiftKey) {
        const ids = getTerminalIds(layout);
        if (ids.length === 0) return;
        let preset: PresetName;
        if (ids.length <= 2) preset = 'even-vertical';
        else if (ids.length === 3) preset = 'main-left';
        else preset = 'grid';
        const newLayout = applyPreset(ids, preset);
        if (newLayout) useLayoutStore.getState().setLayout(activeProjectId, newLayout);
        return;
      }

      // Cmd+1-9: focus pane by index
      const num = parseInt(key);
      if (num >= 1 && num <= 9) {
        const ids = getTerminalIds(layout);
        const target = ids[num - 1];
        if (target) {
          setFocusedTerminal(target);
          const session = useSessionStore.getState().sessions[target];
          session?.terminal?.focus();
        }
        return;
      }
    };

    // CAPTURE PHASE — this is critical to beat the browser's built-in shortcuts
    window.addEventListener('keydown', handler, { capture: true });
    return () => window.removeEventListener('keydown', handler, { capture: true });
  }, [toggleSidebar, setFocusedTerminal]);
}
