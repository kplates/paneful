export type ScEntryStatus = 'M' | 'A' | 'D' | 'R' | 'C' | 'U' | '?';

export interface ScEntry {
  path: string;
  oldPath?: string;
  status: ScEntryStatus;
}

export interface ScStashEntry {
  index: number;
  message: string;
  branch: string;
}

export interface ScStatus {
  staged: ScEntry[];
  changes: ScEntry[];
  untracked: ScEntry[];
  conflicted: ScEntry[];
  stashes: ScStashEntry[];
}

export interface ScheduledJob {
  id: string;
  name: string;
  cron: string;
  command: string;
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
  paused?: boolean;
}

export type ScDiffKind = 'staged' | 'unstaged' | 'untracked' | 'conflicted';
export type ScAction =
  | 'stage'
  | 'unstage'
  | 'discard'
  | 'commit'
  | 'push'
  | 'pull'
  | 'stash:create'
  | 'stash:pop'
  | 'stash:apply'
  | 'stash:drop';

// Client → Server
export type ClientMessage =
  | { type: 'pty:spawn'; terminalId: string; projectId: string; cwd: string; command?: string }
  | { type: 'pty:input'; terminalId: string; data: string }
  | { type: 'pty:resize'; terminalId: string; cols: number; rows: number }
  | { type: 'pty:kill'; terminalId: string }
  | { type: 'project:kill'; projectId: string }
  | { type: 'project:create'; projectId: string; name: string; cwd: string }
  | { type: 'project:remove'; projectId: string }
  | { type: 'open:url'; url: string }
  | { type: 'open:file'; projectId: string; path: string }
  | { type: 'editor:sync'; enabled: boolean }
  | { type: 'sc:set-active'; projectId: string | null }
  | { type: 'sc:diff:request'; projectId: string; file: string; kind: ScDiffKind }
  | { type: 'sc:stage'; projectId: string; files: string[] }
  | { type: 'sc:unstage'; projectId: string; files: string[] }
  | { type: 'sc:discard'; projectId: string; trackedFiles: string[]; untrackedFiles: string[] }
  | { type: 'sc:commit'; projectId: string; message: string }
  | { type: 'sc:push'; projectId: string }
  | { type: 'sc:pull'; projectId: string }
  | { type: 'sc:stash:create'; projectId: string; message: string }
  | { type: 'sc:stash:pop'; projectId: string; index: number }
  | { type: 'sc:stash:apply'; projectId: string; index: number }
  | { type: 'sc:stash:drop'; projectId: string; index: number }
  | { type: 'schedule:list' }
  | { type: 'schedule:runs:list'; jobId?: string }
  | {
      type: 'schedule:create';
      job: { name: string; cron: string; command: string; cwd: string; enabled: boolean };
    }
  | { type: 'schedule:run:log:request'; runId: string }
  | { type: 'schedule:update'; job: ScheduledJob }
  | { type: 'schedule:delete'; jobId: string }
  | { type: 'schedule:toggle'; jobId: string; enabled: boolean }
  | { type: 'schedule:run-now'; jobId: string }
  | { type: 'schedule:run:pause'; runId: string }
  | { type: 'schedule:run:resume'; runId: string }
  | { type: 'schedule:run:remove'; runId: string }
  | { type: 'schedule:run:kill'; runId: string }
  | { type: 'schedule:run:attach'; runId: string }
  | { type: 'schedule:run:detach'; runId: string }
  | { type: 'schedule:run:input'; runId: string; data: string }
  | { type: 'schedule:run:resize'; runId: string; cols: number; rows: number };

// Server → Client
export type ServerMessage =
  | { type: 'pty:output'; terminalId: string; data: string }
  | { type: 'pty:exit'; terminalId: string; exitCode: number }
  | { type: 'project:spawned'; projectId: string; name: string; cwd: string }
  | { type: 'editor:active'; projectName: string }
  | { type: 'editor:status'; needsAccessibility: boolean }
  | { type: 'port:status'; ports: Record<string, number[]> }
  | { type: 'claude:status'; statuses: Record<string, 'active' | 'idle'> }
  | { type: 'git:branch'; branches: Record<string, { branch: string; staged: number; modified: number; ahead: number; behind: number } | null> }
  | { type: 'inbox:paste'; files: string[] }
  | { type: 'sc:status'; projectId: string; status: ScStatus | null }
  | {
      type: 'sc:diff';
      projectId: string;
      file: string;
      kind: ScDiffKind;
      diff: string;
      binary: boolean;
      truncated: boolean;
    }
  | {
      type: 'sc:action:result';
      projectId: string;
      action: ScAction;
      ok: boolean;
      error?: string;
    }
  | { type: 'schedule:jobs'; jobs: ScheduledJob[] }
  | { type: 'schedule:runs'; runs: ScheduledRun[] }
  | { type: 'schedule:run:update'; run: ScheduledRun }
  | {
      type: 'schedule:fire';
      jobId: string;
      jobName: string;
      runId: string;
    }
  | { type: 'schedule:run:log'; runId: string; log: string }
  | { type: 'schedule:run:output'; runId: string; data: string }
  | { type: 'error'; message: string };
