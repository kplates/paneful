import { useEffect, useRef, useCallback } from 'react';
import { ClientMessage, ServerMessage } from '../lib/protocol';
import { useSessionStore } from '../stores/sessionStore';
import { useProjectStore } from '../stores/projectStore';
import { useLayoutStore } from '../stores/layoutStore';
import { useUIStore } from '../stores/uiStore';
import { getTerminalIds } from '../lib/layout-engine';
import { cleanupTerminal, consumePendingCommand } from './useTerminal';

let globalWs: WebSocket | null = null;

function getWsUrl(): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/ws`;
}

export function sendMessage(msg: ClientMessage) {
  if (globalWs?.readyState === WebSocket.OPEN) {
    globalWs.send(JSON.stringify(msg));
  }
}

export function useWebSocket() {
  const setConnectionStatus = useUIStore((s) => s.setConnectionStatus);
  const addProject = useProjectStore((s) => s.addProject);
  const setActiveProject = useProjectStore((s) => s.setActiveProject);
  const reconnectTimeout = useRef<ReturnType<typeof setTimeout>>();

  const connect = useCallback(() => {
    if (globalWs?.readyState === WebSocket.OPEN || globalWs?.readyState === WebSocket.CONNECTING) {
      return;
    }

    setConnectionStatus('connecting');
    const ws = new WebSocket(getWsUrl());
    globalWs = ws;

    ws.onopen = () => {
      setConnectionStatus('connected');
    };

    ws.onmessage = (event) => {
      try {
        const msg: ServerMessage = JSON.parse(event.data);

        // Route PTY output directly to the terminal instance in the store.
        // This works even if the TerminalPane component is unmounted (e.g. project switch),
        // because we write to the xterm buffer which persists.
        if (msg.type === 'pty:output') {
          const session = useSessionStore.getState().sessions[msg.terminalId];
          session?.terminal?.write(msg.data);

          // If a pending command exists for this terminal (from favourite launch),
          // send it on the first output (shell prompt is ready)
          const pending = consumePendingCommand(msg.terminalId);
          if (pending) {
            sendMessage({ type: 'pty:input', terminalId: msg.terminalId, data: pending });
          }
          return;
        }

        // Handle PTY exit — remove the pane entirely
        if (msg.type === 'pty:exit') {
          const tid = msg.terminalId;
          const session = useSessionStore.getState().sessions[tid];
          const projectId = session?.projectId;

          session?.terminal?.dispose();
          useSessionStore.getState().removeSession(tid);
          cleanupTerminal(tid);

          if (projectId) {
            useLayoutStore.getState().removePaneFromProject(projectId, tid);
            useProjectStore.getState().removeTerminalFromProject(projectId, tid);
            const remaining = getTerminalIds(useLayoutStore.getState().getLayout(projectId));
            const focused = useUIStore.getState().focusedTerminalId;
            if (focused === tid && remaining.length > 0) {
              const nextId = remaining[0];
              useUIStore.getState().setFocusedTerminal(nextId);
              const nextSession = useSessionStore.getState().sessions[nextId];
              nextSession?.terminal?.focus();
            } else if (focused === tid) {
              useUIStore.getState().setFocusedTerminal(null);
            }
          }
          return;
        }

        // Handle project spawned (from CLI --spawn)
        if (msg.type === 'project:spawned') {
          addProject({
            id: msg.projectId,
            name: msg.name,
            cwd: msg.cwd,
            terminalIds: [],
          });
          setActiveProject(msg.projectId);
        }
      } catch {
        // ignore invalid messages
      }
    };

    ws.onclose = () => {
      setConnectionStatus('disconnected');
      globalWs = null;
      reconnectTimeout.current = setTimeout(connect, 2000);
    };

    ws.onerror = () => {
      ws.close();
    };
  }, [setConnectionStatus, addProject, setActiveProject]);

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(reconnectTimeout.current);
    };
  }, [connect]);
}
