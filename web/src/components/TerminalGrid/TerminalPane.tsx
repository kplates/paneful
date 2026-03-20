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
import { consumeNativeDropPaths, extractDropPaths, escapeShellPath } from '../../lib/native-drop';
import { PaneHeader } from './PaneHeader';
import { SearchBar } from './SearchBar';
import { DropIndicator } from './DropIndicator';

interface TerminalPaneProps {
  terminalId: string;
  projectId: string;
  cwd: string;
}

export function TerminalPane({ terminalId, projectId, cwd }: TerminalPaneProps) {
  const isFocused = useUIStore((s) => s.focusedTerminalId === terminalId);
  const isDragging = useUIStore((s) => s.draggingTerminalId === terminalId);
  const isSearchOpen = useUIStore((s) => s.searchTerminalId === terminalId);

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

  const handleFileDrop = useCallback((e: React.DragEvent) => {
    const isInternalDrag = useUIStore.getState().draggingTerminalId != null;

    if (!isInternalDrag) {
      const nativePaths = consumeNativeDropPaths();
      if (nativePaths) {
        e.preventDefault();
        e.stopPropagation();
        sendMessage({ type: 'pty:input', terminalId, data: nativePaths.map(escapeShellPath).join(' ') });
        focus();
        return;
      }
      const extracted = extractDropPaths(e.dataTransfer);
      if (extracted.length > 0) {
        e.preventDefault();
        e.stopPropagation();
        sendMessage({ type: 'pty:input', terminalId, data: extracted.map(escapeShellPath).join(' ') });
        focus();
        return;
      }
    }

    if (e.dataTransfer.types.includes('Files') && e.dataTransfer.files.length > 0) {
      e.preventDefault();
      e.stopPropagation();
      const files = Array.from(e.dataTransfer.files);
      Promise.all(
        files.map((f) =>
          fetch('/api/resolve-path', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: f.name, size: f.size, lastModified: f.lastModified, cwd }),
          })
            .then((r) => r.json())
            .then((r: { path: string | null }) => r.path)
            .catch(() => null)
        )
      ).then((paths) => {
        const resolved = paths.filter(Boolean) as string[];
        if (resolved.length > 0) {
          sendMessage({ type: 'pty:input', terminalId, data: resolved.map(escapeShellPath).join(' ') });
          focus();
        }
      });
      return;
    }
    dragProps.onDrop(e);
  }, [terminalId, dragProps, focus]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (useUIStore.getState().draggingTerminalId != null) {
      dragProps.onDragOver(e);
      return;
    }
    if (e.dataTransfer.types.includes('Files') || e.dataTransfer.types.includes('codefiles') || e.dataTransfer.types.includes('text/uri-list') || e.dataTransfer.types.includes('text/plain')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      return;
    }
    dragProps.onDragOver(e);
  }, [dragProps]);

  return (
    <div
      data-terminal-id={terminalId}
      style={{
        borderColor: isFocused ? 'var(--accent)' : 'transparent',
      }}
      className={`
        flex flex-col h-full w-full relative border
        ${isDragging ? 'opacity-40' : ''}
        transition-colors duration-100
      `}
      onClick={focus}
      onDragOver={handleDragOver}
      onDragLeave={dragProps.onDragLeave}
      onDrop={handleFileDrop}
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
      {isSearchOpen && (
        <SearchBar
          terminalId={terminalId}
          onClose={() => {
            useUIStore.getState().closeSearch();
            focus();
          }}
        />
      )}
      <div
        ref={containerRef}
        className="flex-1 min-h-0 min-w-0 overflow-hidden"
      />
      <DropIndicator terminalId={terminalId} />
    </div>
  );
}
