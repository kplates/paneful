import React from 'react';
import { useUIStore } from '../../stores/uiStore';

interface DropIndicatorProps {
  terminalId: string;
}

export function DropIndicator({ terminalId }: DropIndicatorProps) {
  const dropTarget = useUIStore((s) => s.dropTarget);

  if (!dropTarget || dropTarget.terminalId !== terminalId) return null;

  const edge = dropTarget.edge;
  const isCenter = edge === 'center';

  const positionClasses: Record<string, string> = {
    left: 'left-0 top-0 bottom-0 w-1/2',
    right: 'right-0 top-0 bottom-0 w-1/2',
    top: 'left-0 right-0 top-0 h-1/2',
    bottom: 'left-0 right-0 bottom-0 h-1/2',
    center: 'inset-0',
  };

  return (
    <div
      className={`
        absolute ${positionClasses[edge] ?? 'inset-0'}
        pointer-events-none z-20
        ${isCenter ? 'bg-accent/15 border-2 border-accent/40' : 'bg-accent/20 border-2 border-accent/50'}
        rounded-sm transition-all duration-100
      `}
    />
  );
}
