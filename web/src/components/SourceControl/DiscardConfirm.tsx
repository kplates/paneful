import React, { useEffect, useRef } from "react";
import { useProjectStore } from "../../stores/projectStore";
import { useSourceControlStore } from "../../stores/sourceControlStore";
import { sendMessage } from "../../hooks/useWebSocket";

export function DiscardConfirm() {
  const pending = useSourceControlStore((s) => s.pendingDiscard);
  const cancel = useSourceControlStore((s) => s.cancelDiscard);
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (pending && confirmRef.current) {
      confirmRef.current.focus();
    }
  }, [pending]);

  if (!pending) return null;

  const trackedCount = pending.trackedFiles.length;
  const untrackedCount = pending.untrackedFiles.length;
  const all = [...pending.trackedFiles, ...pending.untrackedFiles];

  const handleConfirm = () => {
    if (!activeProjectId) {
      cancel();
      return;
    }
    sendMessage({
      type: "sc:discard",
      projectId: activeProjectId,
      trackedFiles: pending.trackedFiles,
      untrackedFiles: pending.untrackedFiles,
    });
    cancel();
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center"
      onClick={cancel}
    >
      <div
        className="bg-[var(--surface-1)] border border-[var(--border)] rounded-lg shadow-2xl p-5 w-[400px] max-w-[90vw]"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-2">
          Discard changes?
        </h3>
        <p className="text-xs text-[var(--text-secondary)] mb-3">
          {untrackedCount > 0 && trackedCount === 0 ? (
            <>
              The following untracked {untrackedCount === 1 ? "file" : "files"} will be{" "}
              <span className="text-[var(--danger)] font-medium">permanently deleted</span>:
            </>
          ) : (
            <>
              The following {all.length === 1 ? "file" : "files"} will be reset and your changes
              will be <span className="text-[var(--danger)] font-medium">lost</span>:
            </>
          )}
        </p>
        <ul className="text-xs font-mono text-[var(--text-secondary)] bg-[var(--surface-0)] rounded p-2 max-h-40 overflow-auto mb-4">
          {all.map((f) => (
            <li key={f} className="truncate">{f}</li>
          ))}
        </ul>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={cancel}
            className="px-3 py-1.5 text-xs rounded border border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-2)]"
          >
            Cancel
          </button>
          <button
            type="button"
            ref={confirmRef}
            onClick={handleConfirm}
            className="px-3 py-1.5 text-xs rounded bg-[var(--danger)] text-white font-medium hover:opacity-90"
          >
            Discard
          </button>
        </div>
      </div>
    </div>
  );
}
