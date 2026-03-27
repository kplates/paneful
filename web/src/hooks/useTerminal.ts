import { useEffect, useRef, useCallback } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { SearchAddon } from '@xterm/addon-search';
import { WebglAddon } from '@xterm/addon-webgl';
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

// FitAddon instances per terminal (reused across remounts to avoid accumulation)
const fitAddons = new Map<string, FitAddon>();

// WebGL addon instances per terminal (GPU-accelerated rendering)
const webglAddons = new Map<string, WebglAddon>();

// Global terminal registry for theme updates — avoids per-terminal store subscriptions
const terminalRegistry = new Map<string, Terminal>();

function applyThemeToTerminal(term: Terminal) {
  const isLight = getResolvedTheme(useUIStore.getState().theme) === 'light';
  term.options.theme = getCurrentXtermTheme();
  term.options.minimumContrastRatio = isLight ? 7 : 1;
}

// Single global listener: when theme pref changes, update all registered terminals
let _prevTheme = useUIStore.getState().theme;
useUIStore.subscribe((s) => {
  if (s.theme !== _prevTheme) {
    _prevTheme = s.theme;
    for (const term of terminalRegistry.values()) {
      applyThemeToTerminal(term);
    }
  }
});

function loadWebglAddon(id: string, term: Terminal) {
  if (webglAddons.has(id)) return;
  try {
    const addon = new WebglAddon();
    addon.onContextLoss(() => {
      addon.dispose();
      webglAddons.delete(id);
    });
    term.loadAddon(addon);
    webglAddons.set(id, addon);
  } catch {
    // WebGL2 not available — stay on DOM renderer
  }
}

function unloadWebglAddon(id: string) {
  const addon = webglAddons.get(id);
  if (addon) {
    addon.dispose();
    webglAddons.delete(id);
  }
}

// Single global listener: when gpuRendering changes, load/unload WebGL on all terminals
let _prevGpu = useUIStore.getState().gpuRendering;
useUIStore.subscribe((s) => {
  if (s.gpuRendering !== _prevGpu) {
    _prevGpu = s.gpuRendering;
    for (const [id, term] of terminalRegistry) {
      if (s.gpuRendering) {
        loadWebglAddon(id, term);
      } else {
        unloadWebglAddon(id);
      }
    }
  }
});

export function registerTerminal(id: string, term: Terminal) {
  terminalRegistry.set(id, term);
}

export function unregisterTerminal(id: string) {
  terminalRegistry.delete(id);
}

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

      // Reuse existing FitAddon (creating a new one each remount leaks)
      let fitAddon = fitAddons.get(terminalId);
      if (!fitAddon) {
        fitAddon = new FitAddon();
        term.loadAddon(fitAddon);
        fitAddons.set(terminalId, fitAddon);
      }
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
      cursorStyle: 'bar',
      allowProposedApi: true,
      scrollback: 10000,
      minimumContrastRatio: isLight ? 7 : 1,
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon((_event: MouseEvent, uri: string) => {
      if (_event.ctrlKey || _event.metaKey) {
        sendMessage({ type: 'open:url', url: uri });
      }
    });
    const searchAddon = new SearchAddon();

    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);
    term.loadAddon(searchAddon);
    term.open(container);

    fitAddons.set(terminalId, fitAddon);
    searchAddons.set(terminalId, searchAddon);

    terminalRef.current = term;
    fitAddonRef.current = fitAddon;

    // Store the xterm DOM element for future reparenting
    if (term.element) {
      terminalElements.set(terminalId, term.element);
    }

    // Load WebGL addon for GPU-accelerated rendering
    if (useUIStore.getState().gpuRendering) {
      loadWebglAddon(terminalId, term);
    }

    // Click-to-move cursor on the current input line
    const screenEl = term.element?.querySelector('.xterm-screen');
    if (screenEl) {
      screenEl.addEventListener('mouseup', (e: Event) => {
        const me = e as MouseEvent;
        if (me.ctrlKey || me.metaKey) return;

        setTimeout(() => {
          if (term.hasSelection()) return;
          const buf = term.buffer.active;
          if (buf.viewportY !== buf.baseY) return;

          const rect = (screenEl as HTMLElement).getBoundingClientRect();
          const clickCol = Math.floor((me.clientX - rect.left) / (rect.width / term.cols));
          const clickRow = Math.floor((me.clientY - rect.top) / (rect.height / term.rows));
          if (clickRow !== buf.cursorY) return;

          // Clamp to actual line content so we never arrow past the input
          const line = buf.getLine(buf.baseY + buf.cursorY);
          if (!line) return;
          const lineEnd = line.translateToString().trimEnd().length;
          const targetCol = Math.min(clickCol, lineEnd);

          const delta = targetCol - buf.cursorX;
          if (delta === 0) return;
          const seq = delta > 0 ? '\x1b[C' : '\x1b[D';
          sendMessage({ type: 'pty:input', terminalId, data: seq.repeat(Math.abs(delta)) });
        }, 0);
      });
    }

    // Clean up copied text: trim trailing whitespace that xterm pads on each row
    term.element?.addEventListener('copy', (e) => {
      const sel = term.getSelection();
      if (sel) {
        const cleaned = sel.split('\n').map(l => l.trimEnd()).join('\n');
        (e as ClipboardEvent).clipboardData?.setData('text/plain', cleaned);
        e.preventDefault();
      }
    });

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
      // Ctrl+Shift+Arrow: let capture-phase handler move focus between panes
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key) &&
          e.ctrlKey && e.shiftKey && !e.metaKey && !e.altKey) {
        return false;
      }
      // Shift+Arrow: let capture-phase handler swap panes, UNLESS a fullscreen
      // app (vim, nano, less) is running (alternate screen buffer)
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key) &&
          e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
        return term.buffer.active.type === 'alternate';
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

  // Register terminal in global registry for theme updates, apply theme on mount
  useEffect(() => {
    const term = terminalRef.current;
    if (term) {
      applyThemeToTerminal(term);
      registerTerminal(terminalId, term);
    }

    const mql = window.matchMedia('(prefers-color-scheme: light)');
    const onSystemChange = () => {
      if (term && useUIStore.getState().theme === 'system') applyThemeToTerminal(term);
    };
    mql.addEventListener('change', onSystemChange);

    return () => {
      unregisterTerminal(terminalId);
      mql.removeEventListener('change', onSystemChange);
    };
  }, [terminalId]);

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
  fitAddons.delete(terminalId);
  searchAddons.delete(terminalId);
  unloadWebglAddon(terminalId);
  terminalRegistry.delete(terminalId);
}
