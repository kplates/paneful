import { useCallback, useRef } from 'react';
import { useUIStore } from '../stores/uiStore';
import { useLayoutStore } from '../stores/layoutStore';
import { Edge } from '../lib/layout-engine';

export function usePaneDrag(terminalId: string, projectId: string) {
  const setDragging = useUIStore((s) => s.setDragging);
  const setDropTarget = useUIStore((s) => s.setDropTarget);
  const draggingTerminalId = useUIStore((s) => s.draggingTerminalId);
  const movePaneInProject = useLayoutStore((s) => s.movePaneInProject);
  const swapPanesInProject = useLayoutStore((s) => s.swapPanesInProject);

  const onDragStart = useCallback(
    (e: React.DragEvent) => {
      e.dataTransfer.setData('text/plain', terminalId);
      e.dataTransfer.effectAllowed = 'move';
      setDragging(terminalId);
    },
    [terminalId, setDragging]
  );

  const onDragEnd = useCallback(() => {
    setDragging(null);
    setDropTarget(null);
  }, [setDragging, setDropTarget]);

  const onDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';

      if (!draggingTerminalId || draggingTerminalId === terminalId) {
        setDropTarget(null);
        return;
      }

      const rect = e.currentTarget.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width;
      const y = (e.clientY - rect.top) / rect.height;

      // Determine zone: edges (20% margin) or center
      let edge: string = 'center';
      const margin = 0.2;
      if (x < margin) edge = 'left';
      else if (x > 1 - margin) edge = 'right';
      else if (y < margin) edge = 'top';
      else if (y > 1 - margin) edge = 'bottom';

      setDropTarget({ terminalId, edge });
    },
    [terminalId, draggingTerminalId, setDropTarget]
  );

  const onDragLeave = useCallback(() => {
    setDropTarget(null);
  }, [setDropTarget]);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const sourceId = e.dataTransfer.getData('text/plain');
      if (!sourceId || sourceId === terminalId) return;

      const dropTarget = useUIStore.getState().dropTarget;
      if (!dropTarget) return;

      if (dropTarget.edge === 'center') {
        swapPanesInProject(projectId, sourceId, terminalId);
      } else {
        movePaneInProject(projectId, sourceId, terminalId, dropTarget.edge as Edge);
      }

      setDragging(null);
      setDropTarget(null);
    },
    [terminalId, projectId, movePaneInProject, swapPanesInProject, setDragging, setDropTarget]
  );

  return { onDragStart, onDragEnd, onDragOver, onDragLeave, onDrop };
}
