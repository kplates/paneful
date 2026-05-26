import React, { useEffect, useMemo, useRef } from "react";
import { useScheduleStore, isRunActive } from "../../stores/scheduleStore";
import { sendMessage } from "../../hooks/useWebSocket";

export function DeleteScheduleConfirm() {
  const pendingId = useScheduleStore((s) => s.pendingDeleteJobId);
  const cancel = useScheduleStore((s) => s.cancelDelete);
  const jobs = useScheduleStore((s) => s.jobs);
  const runs = useScheduleStore((s) => s.runs);
  const confirmRef = useRef<HTMLButtonElement>(null);

  const job = useMemo(
    () => (pendingId ? jobs.find((j) => j.id === pendingId) ?? null : null),
    [pendingId, jobs],
  );

  const activeCount = useMemo(() => {
    if (!pendingId) return 0;
    return runs.filter((r) => r.jobId === pendingId && isRunActive(r)).length;
  }, [pendingId, runs]);

  useEffect(() => {
    if (pendingId) setTimeout(() => confirmRef.current?.focus(), 0);
  }, [pendingId]);

  if (!pendingId || !job) return null;

  const handleConfirm = () => {
    sendMessage({ type: "schedule:delete", jobId: job.id });
    cancel();
  };

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center"
      onClick={cancel}
    >
      <div
        className="bg-[var(--surface-1)] border border-[var(--border)] rounded-lg shadow-2xl p-5 w-[420px] max-w-[90vw]"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-2">
          Delete schedule?
        </h3>
        <p className="text-xs text-[var(--text-secondary)] mb-3">
          <span className="font-medium text-[var(--text-primary)]">{job.name}</span>
          {" "}will be removed along with all of its run history.
        </p>
        {activeCount > 0 && (
          <p className="text-xs text-[var(--danger)] mb-3">
            {activeCount} {activeCount === 1 ? "run is" : "runs are"} currently in progress — they will be terminated.
          </p>
        )}
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
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
