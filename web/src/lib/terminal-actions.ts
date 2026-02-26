import { useLayoutStore } from '../stores/layoutStore';
import { useSessionStore } from '../stores/sessionStore';
import { useProjectStore } from '../stores/projectStore';
import { sendMessage } from '../hooks/useWebSocket';
import { cleanupTerminal } from '../hooks/useTerminal';
import { getTerminalIds } from './layout-engine';

/**
 * Kill all terminals for a project: dispose xterm instances, clean up sessions,
 * clear layout, and notify the backend.
 */
export function killProjectTerminals(projectId: string) {
  const layout = useLayoutStore.getState().getLayout(projectId);
  const ids = getTerminalIds(layout);
  ids.forEach((tid) => {
    const session = useSessionStore.getState().sessions[tid];
    session?.terminal?.dispose();
    useSessionStore.getState().removeSession(tid);
    cleanupTerminal(tid);
  });
  sendMessage({ type: 'project:kill', projectId });
  useLayoutStore.getState().setLayout(projectId, null);
  useProjectStore.getState().clearProjectTerminals(projectId);
}
