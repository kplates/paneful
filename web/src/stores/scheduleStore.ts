import { create } from "zustand";
import type { ScheduledJob, ScheduledRun } from "../lib/protocol";

// Output subscribers for the currently-viewed run. The viewer subscribes when
// it mounts, unsubscribes when it closes. We don't accumulate output in store
// state (xterm holds the scrollback) — just route chunks to the live listener.
type OutputListener = (data: string) => void;
const outputListeners = new Map<string, Set<OutputListener>>();

export function subscribeRunOutput(runId: string, listener: OutputListener): () => void {
  let set = outputListeners.get(runId);
  if (!set) {
    set = new Set();
    outputListeners.set(runId, set);
  }
  set.add(listener);
  return () => {
    const s = outputListeners.get(runId);
    if (!s) return;
    s.delete(listener);
    if (s.size === 0) outputListeners.delete(runId);
  };
}

interface ScheduleState {
  jobs: ScheduledJob[];
  runs: ScheduledRun[];
  editorOpen: boolean;
  editingJobId: string | null;
  historyJobId: string | null;
  /** runId whose log is currently being viewed in the LogViewer dialog. */
  viewingRunId: string | null;
  /** Cached log contents (string) by runId. */
  runLogs: Record<string, string>;
  /** Job id pending delete confirmation. */
  pendingDeleteJobId: string | null;
  /** Toast notification for a freshly-fired job. */
  fireToast: { jobName: string; projectId: string; runId: string; ts: number } | null;

  setJobs: (jobs: ScheduledJob[]) => void;
  setRuns: (runs: ScheduledRun[]) => void;
  upsertRun: (run: ScheduledRun) => void;
  openEditor: (jobId?: string) => void;
  closeEditor: () => void;
  openHistory: (jobId: string) => void;
  closeHistory: () => void;
  openLog: (runId: string) => void;
  closeLog: () => void;
  setRunLog: (runId: string, log: string) => void;
  appendRunOutput: (runId: string, data: string) => void;
  requestDelete: (jobId: string) => void;
  cancelDelete: () => void;
  showFireToast: (jobName: string, projectId: string, runId: string) => void;
  clearFireToast: () => void;
}

export const useScheduleStore = create<ScheduleState>((set) => ({
  jobs: [],
  runs: [],
  editorOpen: false,
  editingJobId: null,
  historyJobId: null,
  viewingRunId: null,
  runLogs: {},
  pendingDeleteJobId: null,
  fireToast: null,

  setJobs: (jobs) => set({ jobs }),
  setRuns: (runs) => set({ runs }),
  upsertRun: (run) =>
    set((s) => {
      const i = s.runs.findIndex((r) => r.id === run.id);
      if (i >= 0) {
        const next = s.runs.slice();
        next[i] = run;
        return { runs: next };
      }
      return { runs: [...s.runs, run] };
    }),

  openEditor: (jobId) => set({ editorOpen: true, editingJobId: jobId ?? null }),
  closeEditor: () => set({ editorOpen: false, editingJobId: null }),
  openHistory: (jobId) => set({ historyJobId: jobId }),
  closeHistory: () => set({ historyJobId: null }),
  openLog: (runId) => set({ viewingRunId: runId }),
  closeLog: () => set({ viewingRunId: null }),
  setRunLog: (runId, log) =>
    set((s) => ({ runLogs: { ...s.runLogs, [runId]: log } })),
  appendRunOutput: (runId, data) => {
    const listeners = outputListeners.get(runId);
    if (!listeners) return;
    for (const l of listeners) {
      try { l(data); } catch {}
    }
  },
  requestDelete: (jobId) => set({ pendingDeleteJobId: jobId }),
  cancelDelete: () => set({ pendingDeleteJobId: null }),
  showFireToast: (jobName, projectId, runId) =>
    set({ fireToast: { jobName, projectId, runId, ts: Date.now() } }),
  clearFireToast: () => set({ fireToast: null }),
}));

export function isRunActive(run: ScheduledRun): boolean {
  return run.finishedAt === null;
}
