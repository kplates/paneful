import React, { useEffect, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Plus,
  Play,
  Power,
  Trash2,
  History,
  Calendar,
  Loader2,
} from "lucide-react";
import { useScheduleStore, isRunActive } from "../../stores/scheduleStore";
import { sendMessage } from "../../hooks/useWebSocket";
import { nextRun } from "../../lib/cron";

function formatNextRun(cron: string): string {
  const next = nextRun(cron, new Date());
  if (!next) return "—";
  const diffMs = next.getTime() - Date.now();
  if (diffMs < 0) return "—";
  const mins = Math.round(diffMs / 60_000);
  if (mins < 1) return "<1 min";
  if (mins < 60) return `in ${mins} min`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `in ${hours}h`;
  const days = Math.round(hours / 24);
  return `in ${days}d`;
}

export function SchedulesList() {
  const [collapsed, setCollapsed] = useState(false);
  const jobs = useScheduleStore((s) => s.jobs);
  const runs = useScheduleStore((s) => s.runs);
  const openEditor = useScheduleStore((s) => s.openEditor);
  const openHistory = useScheduleStore((s) => s.openHistory);
  const requestDelete = useScheduleStore((s) => s.requestDelete);

  // Re-render every 30s so "next run" countdowns stay current.
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  const activeRunsByJob = new Map<string, number>();
  for (const r of runs) {
    if (isRunActive(r)) {
      activeRunsByJob.set(r.jobId, (activeRunsByJob.get(r.jobId) ?? 0) + 1);
    }
  }

  return (
    <div>
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex items-center gap-1 w-full px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
      >
        {collapsed ? <ChevronRight size={10} /> : <ChevronDown size={10} />}
        Schedules
        <span className="ml-1 px-1 py-0.5 rounded text-[8px] font-bold tracking-wider bg-[var(--accent)]/20 text-[var(--accent)]">
          BETA
        </span>
        <span className="ml-auto flex items-center gap-1 normal-case tracking-normal">
          {jobs.length > 0 && (
            <span className="text-[var(--text-muted)] text-[10px] font-normal">{jobs.length}</span>
          )}
          <span
            onClick={(e) => {
              e.stopPropagation();
              openEditor();
            }}
            title="New schedule"
            className="p-0.5 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-3)] cursor-pointer"
          >
            <Plus size={11} />
          </span>
        </span>
      </button>
      {!collapsed && (
        <div>
          {jobs.length === 0 && (
            <div className="px-4 py-2 text-[10px] text-[var(--text-muted)]">
              No schedules yet
            </div>
          )}
          {jobs.map((job) => {
            const activeCount = activeRunsByJob.get(job.id) ?? 0;
            const cwdLabel = job.cwd.replace(/^\/Users\/[^/]+/, "~");
            const handleToggle = () =>
              sendMessage({ type: "schedule:toggle", jobId: job.id, enabled: !job.enabled });
            const handleRunNow = () =>
              sendMessage({ type: "schedule:run-now", jobId: job.id });
            const handleDelete = () => requestDelete(job.id);
            return (
              <div
                key={job.id}
                onClick={() => openEditor(job.id)}
                className="group flex items-center gap-2 px-4 py-1.5 text-xs cursor-pointer hover:bg-[var(--surface-2)]"
              >
                <Calendar
                  size={12}
                  className={job.enabled ? "text-[var(--accent)]" : "text-[var(--text-muted)]"}
                />
                <div className="flex-1 min-w-0">
                  <div
                    className={`truncate ${job.enabled ? "text-[var(--text-primary)]" : "text-[var(--text-muted)]"}`}
                    title={job.name}
                  >
                    {job.name}
                  </div>
                  <div
                    className="text-[10px] text-[var(--text-muted)] truncate font-mono"
                    title={job.cwd}
                  >
                    {cwdLabel} · {job.enabled ? formatNextRun(job.cron) : "disabled"}
                  </div>
                </div>
                {activeCount > 0 && (
                  <Loader2 size={12} className="animate-spin text-[var(--accent)]" />
                )}
                <div className="hidden group-hover:flex items-center gap-1">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      openHistory(job.id);
                    }}
                    title="Run history"
                    className="p-0.5 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-3)]"
                  >
                    <History size={11} />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRunNow();
                    }}
                    title="Run now"
                    className="p-0.5 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-3)]"
                  >
                    <Play size={11} />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleToggle();
                    }}
                    title={job.enabled ? "Disable" : "Enable"}
                    className="p-0.5 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-3)]"
                  >
                    <Power size={11} />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete();
                    }}
                    title="Delete"
                    className="p-0.5 rounded text-[var(--text-muted)] hover:text-[var(--danger)] hover:bg-[var(--surface-3)]"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
