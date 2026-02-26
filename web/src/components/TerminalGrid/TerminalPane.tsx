import React, { useCallback } from 'react';
import { useTerminal, cleanupTerminal } from '../../hooks/useTerminal';
import { useResizeObserver } from '../../hooks/useResizeObserver';
import { usePaneDrag } from '../../hooks/usePaneDrag';
import { useUIStore } from '../../stores/uiStore';
import { useLayoutStore } from '../../stores/layoutStore';
import { useProjectStore } from '../../stores/projectStore';
import { useSessionStore } from '../../stores/sessionStore';
import { sendMessage } from '../../hooks/useWebSocket';
import { getTerminalIds } from '../../lib/layout-engine';
import { PaneHeader } from './PaneHeader';
import { DropIndicator } from './DropIndicator';

interface TerminalPaneProps {
  terminalId: string;
  projectId: string;
  cwd: string;
}

export function TerminalPane({ terminalId, projectId, cwd }: TerminalPaneProps) {
  const focusedTerminalId = useUIStore((s) => s.focusedTerminalId);
  const draggingTerminalId = useUIStore((s) => s.draggingTerminalId);
  const isFocused = focusedTerminalId === terminalId;
  const isDragging = draggingTerminalId === terminalId;

  const { containerRef, fit, focus } = useTerminal({ terminalId, projectId, cwd });
  const dragProps = usePaneDrag(terminalId, projectId);

  useResizeObserver(containerRef, fit);

  const handleClose = useCallback(() => {
    sendMessage({ type: 'pty:kill', terminalId });
    useLayoutStore.getState().removePaneFromProject(projectId, terminalId);
    useProjectStore.getState().removeTerminalFromProject(projectId, terminalId);
    // Dispose the xterm instance
    const session = useSessionStore.getState().sessions[terminalId];
    session?.terminal?.dispose();
    useSessionStore.getState().removeSession(terminalId);
    cleanupTerminal(terminalId);
    const remaining = getTerminalIds(useLayoutStore.getState().getLayout(projectId));
    useUIStore.getState().setFocusedTerminal(remaining[0] ?? null);
  }, [terminalId, projectId]);

  return (
    <div
      style={{
        borderColor: isFocused ? 'rgba(107,107,128,0.35)' : 'transparent',
      }}
      className={`
        flex flex-col h-full w-full relative border
        ${isDragging ? 'opacity-40' : ''}
        transition-colors duration-100
      `}
      onClick={focus}
      onDragOver={dragProps.onDragOver}
      onDragLeave={dragProps.onDragLeave}
      onDrop={dragProps.onDrop}
    >
      <PaneHeader
        terminalId={terminalId}
        projectId={projectId}
        isFocused={isFocused}
        onClose={handleClose}
        dragProps={{
          onDragStart: dragProps.onDragStart,
          onDragEnd: dragProps.onDragEnd,
        }}
      />
      <div
        ref={containerRef}
        className="flex-1 min-h-0 min-w-0 overflow-hidden"
      />
      <DropIndicator terminalId={terminalId} />
    </div>
  );
}
