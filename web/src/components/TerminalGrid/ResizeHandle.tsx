import React from 'react';
import { Direction } from '../../lib/layout-engine';
import { usePaneResize } from '../../hooks/usePaneResize';

interface ResizeHandleProps {
  projectId: string;
  path: number[];
  direction: Direction;
}

export function ResizeHandle({ projectId, path, direction }: ResizeHandleProps) {
  const { onMouseDown, containerRef } = usePaneResize({ projectId, path, direction });

  const isVertical = direction === 'vertical';

  return (
    <div
      ref={containerRef}
      className={`
        relative z-10 flex-shrink-0
        ${isVertical ? 'w-[4px] cursor-col-resize' : 'h-[4px] cursor-row-resize'}
        group
      `}
      onMouseDown={onMouseDown}
    >
      <div
        className={`
          absolute
          ${isVertical ? 'inset-y-0 -left-[2px] w-[8px]' : 'inset-x-0 -top-[2px] h-[8px]'}
          transition-colors duration-150
          hover:bg-accent/40
          group-active:bg-accent/60
        `}
      />
      <div
        className={`
          ${isVertical ? 'w-full h-full' : 'h-full w-full'}
          bg-[var(--border)]
          transition-colors duration-150
          group-hover:bg-accent/60
          group-active:bg-accent
        `}
      />
    </div>
  );
}
