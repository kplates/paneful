import React from 'react';
import { X, GripHorizontal } from 'lucide-react';
import { useSessionStore } from '../../stores/sessionStore';
import { useUIStore } from '../../stores/uiStore';
import { getTerminalIds } from '../../lib/layout-engine';
import { useLayoutStore } from '../../stores/layoutStore';
import { useProjectStore } from '../../stores/projectStore';

interface PaneHeaderProps {
  terminalId: string;
  projectId: string;
  isFocused: boolean;
  onClose: () => void;
  dragProps: {
    onDragStart: (e: React.DragEvent) => void;
    onDragEnd: () => void;
  };
}

export function PaneHeader({ terminalId, projectId, isFocused, onClose, dragProps }: PaneHeaderProps) {
  const session = useSessionStore((s) => s.sessions[terminalId]);
  const title = session?.title ?? 'Terminal';
  const alive = session?.alive ?? true;

  // Get pane index for display
  const layout = useLayoutStore((s) => s.getLayout(projectId));
  const ids = getTerminalIds(layout);
  const index = ids.indexOf(terminalId) + 1;

  return (
    <div
      draggable
      onDragStart={dragProps.onDragStart}
      onDragEnd={dragProps.onDragEnd}
      className={`
        flex items-center h-7 px-2 gap-1.5 flex-shrink-0
        border-b transition-colors duration-100
        select-none cursor-grab active:cursor-grabbing
        ${isFocused ? 'bg-[var(--surface-3)] border-[var(--accent)]' : 'bg-[var(--surface-2)] border-[var(--border)]'}
      `}
    >
      {/* Drag handle */}
      <div className="text-[var(--text-muted)]">
        <GripHorizontal size={12} />
      </div>

      {/* Pane index */}
      <span className="text-[10px] font-medium text-[var(--text-muted)] tabular-nums">
        {index}
      </span>

      {/* Title */}
      <span className="text-xs text-[var(--text-secondary)] truncate flex-1">
        {title}
      </span>

      {/* Status dot */}
      {!alive && (
        <span className="w-1.5 h-1.5 rounded-full bg-[var(--danger)]" />
      )}

      {/* Close button */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        onMouseDown={(e) => e.stopPropagation()}
        draggable={false}
        className="
          p-0.5 rounded text-[var(--text-muted)]
          hover:text-[var(--danger)] hover:bg-[var(--danger-dim)]
          transition-colors
        "
      >
        <X size={12} />
      </button>
    </div>
  );
}
