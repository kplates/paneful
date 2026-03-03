import { useEffect, useRef, useCallback } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { SearchAddon } from '@xterm/addon-search';
import { sendMessage } from './useWebSocket';
import { useSessionStore } from '../stores/sessionStore';
import { useUIStore, getResolvedTheme } from '../stores/uiStore';
import { XTERM_THEME_DARK, XTERM_THEME_LIGHT } from '../lib/constants';

function getCurrentXtermTheme() {
  const pref = useUIStore.getState().theme;
  return getResolvedTheme(pref) === 'light' ? XTERM_THEME_LIGHT : XTERM_THEME_DARK;
}

// Track which terminals have been spawned on the backend (survives remounts)
const spawnedTerminals = new Set<string>();

// Store the xterm DOM element per terminal so we can reparent it on remount
// instead of calling term.open() again (which xterm doesn't support)
const terminalElements = new Map<string, HTMLElement>();

// Search addons per terminal (persists across remounts with the terminal instance)
const searchAddons = new Map<string, SearchAddon>();

export function getSearchAddon(terminalId: string): SearchAddon | undefined {
  return searchAddons.get(terminalId);
}

// Pending commands to send when a terminal's shell is ready (first output)
const pendingCommands = new Map<string, string>();

export function setPendingCommand(terminalId: string, command: string) {
  pendingCommands.set(terminalId, command);
}

export function consumePendingCommand(terminalId: string): string | null {
  const cmd = pendingCommands.get(terminalId);
  if (cmd !== undefined) {
    pendingCommands.delete(terminalId);
    return cmd;
  }
  return null;
}

interface UseTerminalOptions {
  terminalId: string;
  projectId: string;
  cwd: string;
}

export function useTerminal({ terminalId, projectId, cwd }: UseTerminalOptions) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const lastSizeRef = useRef<{ cols: number; rows: number } | null>(null);

  const setTerminalInstance = useSessionStore((s) => s.setTerminalInstance);
  const createSession = useSessionStore((s) => s.createSession);
  const setFocusedTerminal = useUIStore((s) => s.setFocusedTerminal);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Clear leftover DOM from a previous terminal (React may reuse this container
    // when switching projects or restructuring the layout tree)
    container.innerHTML = '';

    const existingSession = useSessionStore.getState().sessions[terminalId];
    const existingElement = terminalElements.get(terminalId);

    // ── Reattach existing terminal ──
    // If the terminal was already created (layout restructure or project switch),
    // just reparent its DOM element into the new container. Never call term.open() twice.
    if (existingSession?.terminal && existingElement) {
      const term = existingSession.terminal;
      terminalRef.current = term;

      // Move the xterm DOM element to the new container
      container.appendChild(existingElement);

      // Re-create FitAddon (old one is tied to old layout dimensions)
      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      fitAddonRef.current = fitAddon;

      requestAnimationFrame(() => {
        try {
          fitAddon.fit();
          term.scrollToBottom();
          const { cols, rows } = term;
          lastSizeRef.current = { cols, rows };
          sendMessage({ type: 'pty:resize', terminalId, cols, rows });
        } catch {}
      });

      return () => {
        // On unmount, do NOT remove the element from DOM —
        // it will be reparented by the next mount or stay detached briefly
      };
    }

    // ── Create new terminal ──
    const theme = getCurrentXtermTheme();
    const isLight = getResolvedTheme(useUIStore.getState().theme) === 'light';
    const term = new Terminal({
      theme,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'SF Mono', 'Menlo', monospace",
      fontSize: 13,
      lineHeight: 1.2,
      cursorBlink: true,
      cursorStyle: 'block',
      allowProposedApi: true,
      scrollback: 10000,
      minimumContrastRatio: isLight ? 7 : 1,
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();
    const searchAddon = new SearchAddon();

    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);
    term.loadAddon(searchAddon);
    term.open(container);

    searchAddons.set(terminalId, searchAddon);

    terminalRef.current = term;
    fitAddonRef.current = fitAddon;

    // Store the xterm DOM element for future reparenting
    if (term.element) {
      terminalElements.set(terminalId, term.element);
    }

    // Register session in store
    createSession(terminalId, projectId);
    setTerminalInstance(terminalId, term);

    // Shift+Enter → insert a literal newline in the shell command buffer.
    // We send Ctrl+V (\x16 = quoted-insert) followed by newline (\n).
    // This tells zsh/bash to insert the next char literally instead of executing.
    term.attachCustomKeyEventHandler((e) => {
      if (e.key === 'Enter' && e.shiftKey) {
        if (e.type === 'keydown') {
          sendMessage({ type: 'pty:input', terminalId, data: '\x16\n' });
        }
        return false;
      }
      // Cmd+Left/Right → line start/end (Ctrl+A / Ctrl+E)
      if (e.metaKey && !e.altKey && !e.ctrlKey && !e.shiftKey && e.type === 'keydown') {
        if (e.key === 'ArrowLeft') {
          sendMessage({ type: 'pty:input', terminalId, data: '\x01' });
          return false;
        }
        if (e.key === 'ArrowRight') {
          sendMessage({ type: 'pty:input', terminalId, data: '\x05' });
          return false;
        }
        if (e.key === 'Backspace') {
          sendMessage({ type: 'pty:input', terminalId, data: '\x15' });
          return false;
        }
      }
      // Cmd+F: let capture-phase handler in useKeyboardShortcuts open search UI
      if (e.metaKey && e.key === 'f' && !e.altKey && !e.ctrlKey) {
        return false;
      }
      // Cmd+P: let capture-phase handler open command palette
      if (e.metaKey && e.key === 'p' && !e.altKey && !e.ctrlKey) {
        return false;
      }
      // Let Shift+Arrow and Ctrl+Shift+Arrow pass through to our shortcut handler
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key) &&
          e.shiftKey && !e.metaKey && !e.altKey) {
        return false;
      }
      return true;
    });

    // Pipe user keystrokes to the backend
    term.onData((data) => {
      sendMessage({ type: 'pty:input', terminalId, data });
    });

    term.onTitleChange((title) => {
      useSessionStore.getState().setTitle(terminalId, title);
    });

    // Spawn the PTY on the backend — only once per terminalId ever
    if (!spawnedTerminals.has(terminalId)) {
      spawnedTerminals.add(terminalId);

      requestAnimationFrame(() => {
        try { fitAddon.fit(); } catch {}

        sendMessage({
          type: 'pty:spawn',
          terminalId,
          projectId,
          cwd,
        });

        sendMessage({
          type: 'pty:resize',
          terminalId,
          cols: term.cols,
          rows: term.rows,
        });
        lastSizeRef.current = { cols: term.cols, rows: term.rows };

        term.focus();
        setFocusedTerminal(terminalId);
      });
    }

    return () => {
      // Don't dispose or remove — terminal stays alive for reparenting
    };
  }, [terminalId, projectId, cwd, createSession, setTerminalInstance]);

  // Re-theme terminal when theme preference changes or system preference changes
  useEffect(() => {
    const applyTheme = () => {
      const term = terminalRef.current;
      if (term) {
        const isLight = getResolvedTheme(useUIStore.getState().theme) === 'light';
        term.options.theme = getCurrentXtermTheme();
        term.options.minimumContrastRatio = isLight ? 7 : 1;
      }
    };

    let prev = useUIStore.getState().theme;
    const unsub = useUIStore.subscribe((s) => {
      if (s.theme !== prev) {
        prev = s.theme;
        applyTheme();
      }
    });

    const mql = window.matchMedia('(prefers-color-scheme: light)');
    const onSystemChange = () => {
      if (useUIStore.getState().theme === 'system') applyTheme();
    };
    mql.addEventListener('change', onSystemChange);

    return () => {
      unsub();
      mql.removeEventListener('change', onSystemChange);
    };
  }, []);

  const fit = useCallback(() => {
    const fitAddon = fitAddonRef.current;
    const term = terminalRef.current;
    if (!fitAddon || !term) return;

    try {
      fitAddon.fit();
      term.scrollToBottom();
      const { cols, rows } = term;
      const last = lastSizeRef.current;
      if (!last || last.cols !== cols || last.rows !== rows) {
        lastSizeRef.current = { cols, rows };
        sendMessage({ type: 'pty:resize', terminalId, cols, rows });
      }
    } catch {
      // ignore fit errors during mount/unmount
    }
  }, [terminalId]);

  const focus = useCallback(() => {
    terminalRef.current?.focus();
    setFocusedTerminal(terminalId);
  }, [terminalId, setFocusedTerminal]);

  return { containerRef, fit, focus, terminalRef };
}

// Clean up tracking when a terminal is permanently removed
export function cleanupTerminal(terminalId: string) {
  spawnedTerminals.delete(terminalId);
  terminalElements.delete(terminalId);
  searchAddons.delete(terminalId);
}
