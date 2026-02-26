import { useEffect, useRef, useCallback } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { sendMessage } from './useWebSocket';
import { useSessionStore } from '../stores/sessionStore';
import { useUIStore } from '../stores/uiStore';
import { XTERM_THEME } from '../lib/constants';

// Track which terminals have been spawned on the backend (survives remounts)
const spawnedTerminals = new Set<string>();

// Store the xterm DOM element per terminal so we can reparent it on remount
// instead of calling term.open() again (which xterm doesn't support)
const terminalElements = new Map<string, HTMLElement>();

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
    const term = new Terminal({
      theme: XTERM_THEME,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'SF Mono', 'Menlo', monospace",
      fontSize: 13,
      lineHeight: 1.2,
      cursorBlink: true,
      cursorStyle: 'block',
      allowProposedApi: true,
      scrollback: 10000,
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();

    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);
    term.open(container);

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

  const fit = useCallback(() => {
    const fitAddon = fitAddonRef.current;
    const term = terminalRef.current;
    if (!fitAddon || !term) return;

    try {
      fitAddon.fit();
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
}
