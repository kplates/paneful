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
    // Skip if this is an internal pane drag (reorder)
    const isInternalDrag = useUIStore.getState().draggingTerminalId != null;

    // VS Code/Cursor drops: path in text/plain or codefiles, no Files
    if (!isInternalDrag && (e.dataTransfer.types.includes('codefiles') || e.dataTransfer.types.includes('text/plain'))) {
      const codefiles = e.dataTransfer.getData('codefiles');
      let paths: string[] = [];
      if (codefiles) {
        try { paths = JSON.parse(codefiles); } catch { /* ignore */ }
      }
      if (paths.length === 0) {
        const plain = e.dataTransfer.getData('text/plain').trim();
        if (plain && plain.startsWith('/')) {
          paths = plain.split('\n').map((p) => p.trim()).filter(Boolean);
        }
      }
      if (paths.length > 0 && !e.dataTransfer.types.includes('Files')) {
        e.preventDefault();
        e.stopPropagation();
        const escaped = paths.map((p) =>
          /[ ()'"]/.test(p) ? `'${p.replace(/'/g, "'\\''")}'` : p
        );
        sendMessage({ type: 'pty:input', terminalId, data: escaped.join(' ') });
        focus();
        return;
      }
    }

    if (e.dataTransfer.types.includes('Files') && e.dataTransfer.files.length > 0) {
      e.preventDefault();
      e.stopPropagation();

      // Resolve each file's full path via the server (uses Spotlight/locate)
      const files = Array.from(e.dataTransfer.files);
      Promise.all(
        files.map((f) =>
          fetch('/api/resolve-path', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: f.name, size: f.size, lastModified: f.lastModified }),
          })
            .then((r) => r.json())
            .then((r: { path: string | null }) => r.path)
            .catch(() => null)
        )
      ).then((paths) => {
        const resolved = paths.filter(Boolean) as string[];
        if (resolved.length > 0) {
          const escaped = resolved.map((p) =>
            /[ ()'"]/.test(p) ? `'${p.replace(/'/g, "'\\''")}'` : p
          );
          sendMessage({ type: 'pty:input', terminalId, data: escaped.join(' ') });
          focus();
        }
      });
      return;
    }
    dragProps.onDrop(e);
  }, [terminalId, dragProps, focus]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    // Internal pane drag (reorder) takes priority
    if (useUIStore.getState().draggingTerminalId != null) {
      dragProps.onDragOver(e);
      return;
    }
    // Allow file drops from OS or editors (VS Code/Cursor)
    if (e.dataTransfer.types.includes('Files') || e.dataTransfer.types.includes('codefiles') || e.dataTransfer.types.includes('text/plain')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      return;
    }
    dragProps.onDragOver(e);
  }, [dragProps]);


  return (
    <div
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
