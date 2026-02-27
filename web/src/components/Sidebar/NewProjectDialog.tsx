import React, { useState, useRef, useEffect, useCallback } from 'react';
import { X } from 'lucide-react';
import { useProjectStore } from '../../stores/projectStore';

interface NewProjectDialogProps {
  open: boolean;
  onClose: () => void;
  onCreate: (name: string, cwd: string) => void;
  initialName?: string;
  initialCwd?: string;
}

export function NewProjectDialog({ open, onClose, onCreate, initialName, initialCwd }: NewProjectDialogProps) {
  const [name, setName] = useState('');
  const [cwd, setCwd] = useState('~');
  const [error, setError] = useState<string | null>(null);
  const [validating, setValidating] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setName(initialName ?? '');
      setCwd(initialCwd ?? '~');
      setError(null);
      setTimeout(() => nameRef.current?.focus(), 50);
    }
  }, [open, initialName, initialCwd]);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    const trimmedCwd = cwd.trim() || '~';

    // Check for duplicate path
    const projects = Object.values(useProjectStore.getState().projects);
    const duplicate = projects.find((p) => p.cwd === trimmedCwd);
    if (duplicate) {
      setError(`Project "${duplicate.name}" already uses this directory`);
      return;
    }

    // Validate path on server
    setValidating(true);
    setError(null);
    try {
      const res = await fetch('/api/validate-path', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: trimmedCwd }),
      });
      const { valid } = await res.json();
      if (!valid) {
        setError('Directory does not exist');
        setValidating(false);
        return;
      }
    } catch {
      setError('Could not validate path');
      setValidating(false);
      return;
    }
    setValidating(false);

    onCreate(name.trim(), trimmedCwd);
    onClose();
  }, [name, cwd, onCreate, onClose]);

  if (!open) return null;

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
              onChange={(e) => { setCwd(e.target.value); setError(null); }}
              placeholder="/path/to/project"
              className={`
                w-full px-3 py-2 text-sm font-mono
                bg-[var(--surface-0)] border
                text-[var(--text-primary)] placeholder:text-[var(--text-muted)]
                rounded-lg outline-none
                transition-colors
                ${error ? 'border-[var(--danger)] focus:border-[var(--danger)] focus:ring-1 focus:ring-[var(--danger)]/30' : 'border-[var(--border)] focus:border-accent focus:ring-1 focus:ring-accent/30'}
              `}
            />
            {error && (
              <p className="mt-1.5 text-[11px] text-[var(--danger)]">{error}</p>
            )}
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
              disabled={!name.trim() || validating}
              className="
                px-3 py-1.5 text-xs font-medium
                bg-accent hover:bg-accent/80
                disabled:opacity-40 disabled:cursor-not-allowed
                text-white rounded-lg transition-colors
              "
            >
              {validating ? 'Checking...' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
