import React, { useEffect } from "react";
import { Calendar } from "lucide-react";
import { useScheduleStore } from "../../stores/scheduleStore";

const AUTO_DISMISS_MS = 4000;

export function ScheduleFireToast() {
  const toast = useScheduleStore((s) => s.fireToast);
  const clear = useScheduleStore((s) => s.clearFireToast);
  const openLog = useScheduleStore((s) => s.openLog);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(clear, AUTO_DISMISS_MS);
    return () => clearTimeout(t);
  }, [toast, clear]);

  if (!toast) return null;

  return (
    <div
      onClick={() => {
        openLog(toast.runId);
        clear();
      }}
      title="Open this run"
      className="absolute top-2 right-2 z-50 px-3 py-2 bg-[var(--surface-1)] border border-[var(--accent)]/40 rounded-lg shadow-lg flex items-center gap-2 text-xs cursor-pointer hover:bg-[var(--surface-2)] animate-fade-in"
    >
      <Calendar size={14} className="text-[var(--accent)]" />
      <div>
        <div className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
          Schedule running
        </div>
        <div className="text-[var(--text-primary)] font-medium">{toast.jobName}</div>
      </div>
    </div>
  );
}
