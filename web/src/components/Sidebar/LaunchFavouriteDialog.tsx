import React from 'react';
import { X, AlertTriangle } from 'lucide-react';

interface LaunchFavouriteDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  terminalCount: number;
  favouriteName: string;
}

export function LaunchFavouriteDialog({
  open,
  onClose,
  onConfirm,
  terminalCount,
  favouriteName,
}: LaunchFavouriteDialogProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="bg-[var(--surface-1)] border border-[var(--border)] rounded-xl w-[380px] shadow-2xl animate-fade-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
          <h3 className="text-sm font-medium text-[var(--text-primary)]">Launch Favourite</h3>
          <button
            onClick={onClose}
            className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-3)] transition-colors"
          >
            <X size={14} />
          </button>
        </div>
        <div className="p-4 space-y-4">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-lg bg-yellow-500/10">
              <AlertTriangle size={16} className="text-yellow-500" />
            </div>
            <div className="text-sm text-[var(--text-secondary)]">
              Launching <span className="font-medium text-[var(--text-primary)]">{favouriteName}</span> will
              close {terminalCount} existing terminal{terminalCount !== 1 ? 's' : ''}. Continue?
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button
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
              onClick={() => { onConfirm(); onClose(); }}
              className="
                px-3 py-1.5 text-xs font-medium
                bg-accent hover:bg-accent/80
                text-white rounded-lg transition-colors
              "
            >
              Launch
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
