import { useCallback, useRef } from 'react';
import { useLayoutStore } from '../stores/layoutStore';
import { Direction } from '../lib/layout-engine';

interface UsePaneResizeOptions {
  projectId: string;
  path: number[];
  direction: Direction;
}

export function usePaneResize({ projectId, path, direction }: UsePaneResizeOptions) {
  const resizePaneInProject = useLayoutStore((s) => s.resizePaneInProject);
  const containerRef = useRef<HTMLDivElement>(null);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const container = containerRef.current?.parentElement;
      if (!container) return;

      const rect = container.getBoundingClientRect();
      const startPos = direction === 'vertical' ? e.clientX : e.clientY;
      const totalSize = direction === 'vertical' ? rect.width : rect.height;

      const onMouseMove = (moveEvent: MouseEvent) => {
        const currentPos = direction === 'vertical' ? moveEvent.clientX : moveEvent.clientY;
        const offset = direction === 'vertical' ? rect.left : rect.top;
        const newRatio = (currentPos - offset) / totalSize;
        resizePaneInProject(projectId, path, newRatio);
      };

      const onMouseUp = () => {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
      document.body.style.cursor = direction === 'vertical' ? 'col-resize' : 'row-resize';
      document.body.style.userSelect = 'none';
    },
    [projectId, path, direction, resizePaneInProject]
  );

  return { onMouseDown, containerRef };
}
