import fs from 'node:fs';
import path from 'node:path';

export interface ScheduledJob {
  id: string;
  name: string;
  /** 5-field cron expression (minute hour dom month dow). */
  cron: string;
  command: string;
  /** Working directory for the run. */
  cwd: string;
  enabled: boolean;
  createdAt: number;
}

export interface ScheduledRun {
  id: string;
  jobId: string;
  startedAt: number;
  finishedAt: number | null;
  exitCode: number | null;
  terminalId: string | null;
  /** True if the PTY has been paused (SIGSTOP). Resume sends SIGCONT. */
  paused?: boolean;
}

interface Persisted {
  jobs: ScheduledJob[];
  runs: ScheduledRun[];
}

const RUN_HISTORY_LIMIT = 200;

export class ScheduleStore {
  private jobs = new Map<string, ScheduledJob>();
  private runs: ScheduledRun[] = [];
  private filePath: string;

  constructor(dataDir: string, getProjectCwd?: (projectId: string) => string | undefined) {
    this.filePath = path.join(dataDir, 'schedules.json');
    if (fs.existsSync(this.filePath)) {
      try {
        const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf-8')) as Persisted & {
          jobs?: Array<ScheduledJob & { projectId?: string }>;
        };
        let mutated = false;
        for (const job of raw.jobs ?? []) {
          // Migration: older schedules used projectId, now we store cwd directly
          if (!job.cwd && job.projectId && getProjectCwd) {
            const cwd = getProjectCwd(job.projectId);
            if (cwd) {
              job.cwd = cwd;
              mutated = true;
            }
          }
          delete job.projectId;
          if (job.cwd) this.jobs.set(job.id, job);
        }
        this.runs = (raw.runs ?? []).slice(-RUN_HISTORY_LIMIT);
        if (mutated) this.persist();
      } catch {
        // corrupt file, start fresh
      }
    }
  }

  listJobs(): ScheduledJob[] {
    return Array.from(this.jobs.values()).sort((a, b) => a.createdAt - b.createdAt);
  }

  getJob(id: string): ScheduledJob | undefined {
    return this.jobs.get(id);
  }

  createJob(job: ScheduledJob): void {
    this.jobs.set(job.id, job);
    this.persist();
  }

  updateJob(job: ScheduledJob): void {
    if (!this.jobs.has(job.id)) return;
    this.jobs.set(job.id, job);
    this.persist();
  }

  deleteJob(id: string): void {
    this.jobs.delete(id);
    // Drop runs for the deleted job too
    this.runs = this.runs.filter((r) => r.jobId !== id);
    this.persist();
  }

  listRuns(jobId?: string): ScheduledRun[] {
    return jobId ? this.runs.filter((r) => r.jobId === jobId) : this.runs.slice();
  }

  addRun(run: ScheduledRun): void {
    this.runs.push(run);
    if (this.runs.length > RUN_HISTORY_LIMIT) {
      this.runs.splice(0, this.runs.length - RUN_HISTORY_LIMIT);
    }
    this.persist();
  }

  updateRun(runId: string, patch: Partial<ScheduledRun>): ScheduledRun | undefined {
    const idx = this.runs.findIndex((r) => r.id === runId);
    if (idx < 0) return undefined;
    this.runs[idx] = { ...this.runs[idx], ...patch };
    this.persist();
    return this.runs[idx];
  }

  removeRun(runId: string): void {
    this.runs = this.runs.filter((r) => r.id !== runId);
    this.persist();
  }

  hasEnabledJobs(): boolean {
    for (const job of this.jobs.values()) {
      if (job.enabled) return true;
    }
    return false;
  }

  private persist(): void {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const data: Persisted = { jobs: this.listJobs(), runs: this.runs };
      fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2));
    } catch {
      console.error('Failed to persist schedules');
    }
  }
}
