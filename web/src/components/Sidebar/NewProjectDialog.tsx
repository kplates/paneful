import React, { useState, useRef, useEffect } from 'react';
import { X } from 'lucide-react';

interface NewProjectDialogProps {
  open: boolean;
  onClose: () => void;
  onCreate: (name: string, cwd: string) => void;
}

export function NewProjectDialog({ open, onClose, onCreate }: NewProjectDialogProps) {
  const [name, setName] = useState('');
  const [cwd, setCwd] = useState('~');
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setName('');
      setCwd('~');
      setTimeout(() => nameRef.current?.focus(), 50);
    }
  }, [open]);

  if (!open) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    const resolvedCwd = cwd.replace(/^~/, '$HOME');
    onCreate(name.trim(), cwd.trim() || '~');
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="bg-[var(--surface-1)] border border-[var(--border)] rounded-xl w-[400px] shadow-2xl animate-fade-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
          <h3 className="text-sm font-medium text-[var(--text-primary)]">New Project</h3>
          <button
            onClick={onClose}
            className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-3)] transition-colors"
          >
            <X size={14} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          <div>
            <label className="block text-xs text-[var(--text-secondary)] mb-1.5">Project Name</label>
            <input
              ref={nameRef}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="my-project"
              className="
                w-full px-3 py-2 text-sm
                bg-[var(--surface-0)] border border-[var(--border)]
                text-[var(--text-primary)] placeholder:text-[var(--text-muted)]
                rounded-lg outline-none
                focus:border-accent focus:ring-1 focus:ring-accent/30
                transition-colors
              "
            />
          </div>
          <div>
            <label className="block text-xs text-[var(--text-secondary)] mb-1.5">Working Directory</label>
            <input
              value={cwd}
              onChange={(e) => setCwd(e.target.value)}
              placeholder="/path/to/project"
              className="
                w-full px-3 py-2 text-sm font-mono
                bg-[var(--surface-0)] border border-[var(--border)]
                text-[var(--text-primary)] placeholder:text-[var(--text-muted)]
                rounded-lg outline-none
                focus:border-accent focus:ring-1 focus:ring-accent/30
                transition-colors
              "
            />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="
                px-3 py-1.5 text-xs text-[var(--text-secondary)]
                hover:text-[var(--text-primary)] hover:bg-[var(--surface-3)]
                rounded-lg transition-colors
              "
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!name.trim()}
              className="
                px-3 py-1.5 text-xs font-medium
                bg-accent hover:bg-accent/80
                disabled:opacity-40 disabled:cursor-not-allowed
                text-white rounded-lg transition-colors
              "
            >
              Create
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
