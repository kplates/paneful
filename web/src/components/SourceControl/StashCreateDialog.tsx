import React, { useEffect, useRef, useState } from "react";
import { useProjectStore } from "../../stores/projectStore";
import { useSourceControlStore } from "../../stores/sourceControlStore";
import { sendMessage } from "../../hooks/useWebSocket";

export function StashCreateDialog() {
  const open = useSourceControlStore((s) => s.pendingStashCreate);
  const close = useSourceControlStore((s) => s.closeStashCreate);
  const setInFlight = useSourceControlStore((s) => s.setActionInFlight);
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const inputRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (open) {
      setMessage("");
      // Defer focus to next tick so the input is mounted
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  if (!open) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeProjectId) {
      close();
      return;
    }
    setInFlight("stash:create", true);
    sendMessage({ type: "sc:stash:create", projectId: activeProjectId, message });
    close();
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center"
      onClick={close}
    >
      <form
        onSubmit={handleSubmit}
        className="bg-[var(--surface-1)] border border-[var(--border)] rounded-lg shadow-2xl p-5 w-[420px] max-w-[90vw]"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">
          Create stash
        </h3>
        <input
          ref={inputRef}
          type="text"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Optional message"
          className="w-full px-2 py-1.5 text-xs rounded bg-[var(--surface-0)] border border-[var(--border)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)] mb-3"
        />
        <p className="text-xs text-[var(--text-muted)] mb-4">
          All tracked and untracked changes will be stashed. Your working tree returns to a clean state.
        </p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={close}
            className="px-3 py-1.5 text-xs rounded border border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-2)]"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="px-3 py-1.5 text-xs rounded bg-[var(--accent)] text-[var(--surface-0)] font-medium hover:opacity-90"
          >
            Stash
          </button>
        </div>
      </form>
    </div>
  );
}
