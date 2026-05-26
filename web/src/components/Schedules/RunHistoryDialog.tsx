import React, { useMemo } from "react";
import { X, Trash2, Loader2, Pause, Play, OctagonX } from "lucide-react";
import { useScheduleStore, isRunActive } from "../../stores/scheduleStore";
import { sendMessage } from "../../hooks/useWebSocket";

function formatTime(ts: number): string {
  return new Date(ts).toLocaleString();
}

function formatDuration(start: number, end: number | null): string {
  if (end === null) return "—";
  const ms = end - start;
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3600_000) return `${Math.round(ms / 60_000)}m`;
  return `${(ms / 3600_000).toFixed(1)}h`;
}

export function RunHistoryDialog() {
  const historyJobId = useScheduleStore((s) => s.historyJobId);
  const closeHistory = useScheduleStore((s) => s.closeHistory);
  const openLog = useScheduleStore((s) => s.openLog);
  const jobs = useScheduleStore((s) => s.jobs);
  const runs = useScheduleStore((s) => s.runs);

  const handleOpen = (runId: string) => {
    openLog(runId);
    closeHistory();
  };

  const job = useMemo(
    () => (historyJobId ? jobs.find((j) => j.id === historyJobId) ?? null : null),
    [historyJobId, jobs],
  );

  const jobRuns = useMemo(() => {
    if (!historyJobId) return [];
    return runs.filter((r) => r.jobId === historyJobId).slice().sort((a, b) => b.startedAt - a.startedAt);
  }, [runs, historyJobId]);

  if (!historyJobId || !job) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center"
      onClick={closeHistory}
    >
      <div
        className="bg-[var(--surface-1)] border border-[var(--border)] rounded-lg shadow-2xl w-[640px] max-w-[90vw] max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--border)]">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-[var(--text-primary)] truncate">{job.name}</h3>
            <div className="text-[10px] text-[var(--text-muted)] font-mono truncate" title={job.cwd}>
              {job.cwd} · {job.cron}
            </div>
          </div>
          <button
            type="button"
            onClick={closeHistory}
            className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-auto">
          {jobRuns.length === 0 ? (
            <div className="px-5 py-8 text-xs text-[var(--text-muted)] text-center">
              No runs yet. Use the play button to trigger one now.
            </div>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[var(--text-muted)] uppercase tracking-wide text-[10px]">
                  <th className="px-5 py-2 font-medium">Started</th>
                  <th className="px-2 py-2 font-medium">Duration</th>
                  <th className="px-2 py-2 font-medium">Status</th>
                  <th className="px-2 py-2 font-medium text-right pr-5"></th>
                </tr>
              </thead>
              <tbody>
                {jobRuns.map((run) => {
                  const active = isRunActive(run);
                  const paused = !!run.paused;
                  return (
                    <tr
                      key={run.id}
                      onClick={() => handleOpen(run.id)}
                      className="border-t border-[var(--border)]/60 hover:bg-[var(--surface-2)] cursor-pointer"
                    >
                      <td className="px-5 py-2 text-[var(--text-secondary)] tabular-nums">
                        {formatTime(run.startedAt)}
                      </td>
                      <td className="px-2 py-2 text-[var(--text-secondary)] tabular-nums">
                        {formatDuration(run.startedAt, run.finishedAt)}
                      </td>
                      <td className="px-2 py-2">
                        {active && paused ? (
                          <span className="inline-flex items-center gap-1.5 text-yellow-500">
                            <Pause size={11} fill="currentColor" />
                            Paused
                          </span>
                        ) : active ? (
                          <span className="inline-flex items-center gap-1.5 text-[var(--accent)]">
                            <Loader2 size={11} className="animate-spin" />
                            Running
                          </span>
                        ) : run.exitCode === -1 ? (
                          <span className="inline-flex items-center gap-1.5 text-[var(--danger)]">
                            <span className="inline-flex items-center justify-center w-[11px] h-[11px]">
                              <span className="w-2 h-2 rounded-full bg-current" />
                            </span>
                            Terminated
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 text-[var(--text-muted)]">
                            <span className="inline-flex items-center justify-center w-[11px] h-[11px]">
                              <span className="w-2 h-2 rounded-full bg-current" />
                            </span>
                            Closed
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-2 text-right pr-5">
                        <div className="flex justify-end items-center gap-1">
                          {active && (paused ? (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                sendMessage({ type: "schedule:run:resume", runId: run.id });
                              }}
                              title="Resume (SIGCONT)"
                              className="p-0.5 rounded text-[var(--text-muted)] hover:text-[var(--accent)] hover:bg-[var(--surface-3)]"
                            >
                              <Play size={11} fill="currentColor" />
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                sendMessage({ type: "schedule:run:pause", runId: run.id });
                              }}
                              title="Pause (SIGSTOP)"
                              className="p-0.5 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-3)]"
                            >
                              <Pause size={11} fill="currentColor" />
                            </button>
                          ))}
                          {active && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                sendMessage({ type: "schedule:run:kill", runId: run.id });
                              }}
                              title="Terminate"
                              className="p-0.5 rounded text-[var(--text-muted)] hover:text-[var(--danger)] hover:bg-[var(--surface-3)]"
                            >
                              <OctagonX size={11} />
                            </button>
                          )}
                          {!active && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                sendMessage({ type: "schedule:run:remove", runId: run.id });
                              }}
                              title="Remove from history"
                              className="p-0.5 rounded text-[var(--text-muted)] hover:text-[var(--danger)] hover:bg-[var(--surface-3)]"
                            >
                              <Trash2 size={11} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
