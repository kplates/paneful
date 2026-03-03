import React from 'react';
import { Folder, Trash2, XCircle, Terminal } from 'lucide-react';
import { Project } from '../../stores/projectStore';

interface ProjectItemProps {
  project: Project;
  isActive: boolean;
  hasActivePorts: boolean;
  onClick: () => void;
  onKill: () => void;
  onRemove: () => void;
}

export function ProjectItem({ project, isActive, hasActivePorts, onClick, onKill, onRemove }: ProjectItemProps) {
  const termCount = project.terminalIds.length;

  return (
    <div
      onClick={onClick}
      className={`
        group flex items-center gap-2 px-3 py-2 mx-2 rounded-lg cursor-pointer
        transition-colors duration-100
        ${isActive
          ? 'bg-accent/10 text-[var(--text-primary)]'
          : 'text-[var(--text-secondary)] hover:bg-[var(--surface-2)] hover:text-[var(--text-primary)]'
        }
      `}
    >
      <Folder size={14} className={isActive ? 'text-accent' : 'text-[var(--text-muted)]'} />

      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium truncate flex items-center gap-1.5">
          {project.name}
          {hasActivePorts && (
            <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-[var(--success)]" />
          )}
        </div>
        <div className="text-[10px] text-[var(--text-muted)] truncate font-mono">{project.cwd}</div>
      </div>

      {termCount > 0 && (
        <span className="text-[10px] tabular-nums px-1.5 py-0.5 rounded-full bg-[var(--surface-3)] text-[var(--text-muted)] flex items-center gap-0.5">
          <Terminal size={8} />
          {termCount}
        </span>
      )}

      <div className="hidden group-hover:flex items-center gap-0.5">
        {termCount > 0 && (
          <button
            onClick={(e) => { e.stopPropagation(); onKill(); }}
            title="Kill all terminals"
            className="p-0.5 rounded text-[var(--text-muted)] hover:text-[var(--danger)] hover:bg-[var(--danger-dim)] transition-colors"
          >
            <XCircle size={12} />
          </button>
        )}
        <button
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          title="Remove project"
          className="p-0.5 rounded text-[var(--text-muted)] hover:text-[var(--danger)] hover:bg-[var(--danger-dim)] transition-colors"
        >
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  );
}
