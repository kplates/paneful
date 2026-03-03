import React, { useCallback, useEffect } from 'react';
import { useWebSocket } from './hooks/useWebSocket';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useEditorFocus } from './hooks/useEditorFocus';
import { useProjectStore } from './stores/projectStore';
import { useLayoutStore } from './stores/layoutStore';
import { useUIStore } from './stores/uiStore';
import { useFavouriteStore } from './stores/favouriteStore';
import { getTerminalIds } from './lib/layout-engine';
import { Sidebar } from './components/Sidebar/Sidebar';
import { Toolbar } from './components/Toolbar/Toolbar';
import { TerminalGrid } from './components/TerminalGrid/TerminalGrid';
import { EmptyState } from './components/EmptyState';
import { SyncToast } from './components/SyncToast';
import { Direction } from './lib/layout-engine';

export function App() {
  useWebSocket();
  useKeyboardShortcuts();
  useEditorFocus();

  useEffect(() => {
    useProjectStore.getState().hydrateFromServer();
    useFavouriteStore.getState().hydrateFromServer();
    useUIStore.getState().hydrateFromServer();
  }, []);

  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const activeProject = useProjectStore((s) =>
    s.activeProjectId ? s.projects[s.activeProjectId] : null
  );
  const layout = useLayoutStore((s) =>
    activeProjectId ? s.getLayout(activeProjectId) : null
  );
  const focusedTerminalId = useUIStore((s) => s.focusedTerminalId);
  const setFocusedTerminal = useUIStore((s) => s.setFocusedTerminal);
  const addTerminalToProject = useProjectStore((s) => s.addTerminalToProject);

  const handleNewPane = useCallback(
    (direction: Direction) => {
      if (!activeProjectId || !activeProject) return;

      const newId = crypto.randomUUID();
      const ids = getTerminalIds(layout);
      const refId = focusedTerminalId ?? ids[0];

      if (refId) {
        useLayoutStore.getState().addPaneToProject(activeProjectId, refId, newId, direction);
      } else {
        useLayoutStore.getState().setLayout(activeProjectId, {
          type: 'leaf',
          terminalId: newId,
        });
      }
      addTerminalToProject(activeProjectId, newId);
      setFocusedTerminal(newId);
    },
    [activeProjectId, activeProject, layout, focusedTerminalId, addTerminalToProject, setFocusedTerminal]
  );

  const handleNewTerminal = useCallback(() => {
    handleNewPane('vertical');
  }, [handleNewPane]);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[var(--surface-0)]">
      <Sidebar />

      <div className="relative flex-1 flex flex-col min-w-0">
        <SyncToast />
        <Toolbar onNewPane={handleNewPane} />

        <div className="flex-1 min-h-0 min-w-0">
          {layout ? (
            <TerminalGrid
              key={activeProjectId!}
              node={layout}
              projectId={activeProjectId!}
              cwd={activeProject?.cwd ?? '/'}
            />
          ) : (
            <EmptyState
              onNewTerminal={handleNewTerminal}
              projectName={activeProject?.name}
            />
          )}
        </div>
      </div>
    </div>
  );
}
