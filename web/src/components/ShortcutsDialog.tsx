import React from 'react';
import { X } from 'lucide-react';

interface ShortcutsDialogProps {
  open: boolean;
  onClose: () => void;
}

const KEY_CLASS =
  'border border-[var(--border)] rounded-md px-1.5 py-0.5 bg-[var(--surface-0)] text-[11px] font-mono min-w-[24px] text-center inline-flex items-center justify-center shadow-[0_1px_0_var(--border)]';

const shortcuts: { keys: string[]; action: string }[] = [
  { keys: ['⌘', 'N'], action: 'New pane (vertical)' },
  { keys: ['⌘', '⇧', 'N'], action: 'New pane (horizontal)' },
  { keys: ['⌘', 'W'], action: 'Close pane' },
  { keys: ['⌘', 'D'], action: 'Toggle sidebar' },
  { keys: ['⌘', 'T'], action: 'Cycle layout' },
  { keys: ['⌘', 'R'], action: 'Auto reorganize' },
  { keys: ['⌘', '1-9'], action: 'Focus pane by number' },
  { keys: ['⌘', '←→↑↓'], action: 'Move focus' },
  { keys: ['⌘', '⇧', '←→↑↓'], action: 'Swap panes' },
  { keys: ['⌥', '←→↑↓'], action: 'Swap panes' },
  { keys: ['Shift', 'Enter'], action: 'Insert new line' },
];

export function ShortcutsDialog({ open, onClose }: ShortcutsDialogProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="bg-[var(--surface-1)] border border-[var(--border)] rounded-xl w-[440px] shadow-2xl animate-fade-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
          <h3 className="text-sm font-medium text-[var(--text-primary)]">Keyboard Shortcuts</h3>
          <button
            onClick={onClose}
            className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-3)] transition-colors"
          >
            <X size={14} />
          </button>
        </div>
        <div className="p-4 space-y-2">
          {shortcuts.map((s, i) => (
            <div key={i} className="flex items-center justify-between py-1">
              <div className="flex items-center gap-1">
                {s.keys.map((k, j) => (
                  <kbd key={j} className={KEY_CLASS}>
                    {k}
                  </kbd>
                ))}
              </div>
              <span className="text-xs text-[var(--text-secondary)]">{s.action}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
