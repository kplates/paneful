import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { watch, type FSWatcher } from 'node:fs';
import type { ProjectStore } from './project-store.js';

const execFileP = promisify(execFile);

export type EntryStatus = 'M' | 'A' | 'D' | 'R' | 'C' | 'U' | '?';

export interface SourceControlEntry {
  path: string;
  oldPath?: string;
  status: EntryStatus;
}

export interface SourceControlStatus {
  staged: SourceControlEntry[];
  changes: SourceControlEntry[];
  untracked: SourceControlEntry[];
  conflicted: SourceControlEntry[];
}

export type DiffKind = 'staged' | 'unstaged' | 'untracked' | 'conflicted';

export interface DiffResult {
  diff: string;
  binary: boolean;
  truncated: boolean;
}

export type ActionKind = 'stage' | 'unstage' | 'discard' | 'commit';

const SAFETY_POLL_MS = 15_000;
const WATCH_DEBOUNCE_MS = 300;
// Headroom for whole-file diffs (git -U99999). Most source files fit comfortably.
const DIFF_MAX_BYTES = 5_000_000;
const DIFF_TIMEOUT_MS = 5_000;
const ACTION_TIMEOUT_MS = 10_000;
// Force enough unified-diff context to cover any reasonable file
const FULL_CONTEXT_FLAG = '-U99999';
// Filenames/dirs in change events to ignore (lots of churn, no user-visible status impact)
const IGNORE_PATHS = ['.git/objects', '.git/lfs', '.git/logs', 'node_modules', '.next/cache'];

export class GitSourceControl {
  private projectStore: ProjectStore;
  private onStatus: (projectId: string, status: SourceControlStatus | null) => void;
  private activeProjectId: string | null = null;
  private lastStatus: SourceControlStatus | null = null;
  private safetyTimer: ReturnType<typeof setInterval> | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private watcher: FSWatcher | null = null;
  private polling = false;
  private destroyed = false;
  private paused = true;

  constructor(
    projectStore: ProjectStore,
    onStatus: (projectId: string, status: SourceControlStatus | null) => void,
  ) {
    this.projectStore = projectStore;
    this.onStatus = onStatus;
  }

  setActive(projectId: string | null): void {
    if (projectId === this.activeProjectId) return;
    this.stopWatcher();
    this.activeProjectId = projectId;
    this.lastStatus = null;
    if (projectId && !this.paused) {
      this.startWatcher(projectId);
      this.poll();
    }
  }

  resume(): void {
    if (this.destroyed || !this.paused) return;
    this.paused = false;
    if (this.activeProjectId) {
      this.startWatcher(this.activeProjectId);
      this.poll();
      this.safetyTimer = setInterval(() => this.poll(), SAFETY_POLL_MS);
    }
  }

  pause(): void {
    this.paused = true;
    this.stopWatcher();
    if (this.safetyTimer) {
      clearInterval(this.safetyTimer);
      this.safetyTimer = null;
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  destroy(): void {
    this.destroyed = true;
    this.pause();
    this.lastStatus = null;
    this.activeProjectId = null;
  }

  private startWatcher(projectId: string): void {
    const project = this.projectStore.list().find((p) => p.id === projectId);
    if (!project) return;
    try {
      this.watcher = watch(project.cwd, { recursive: true }, (_event, filename) => {
        if (!filename) return;
        // Skip noisy paths (e.g., git objects, node_modules build chatter)
        for (const ignore of IGNORE_PATHS) {
          if (filename.includes(ignore)) return;
        }
        this.scheduleRePoll();
      });
      this.watcher.on('error', () => {
        // Watcher failed (path missing, permission denied, etc.) — safety poll still runs
        this.stopWatcher();
      });
    } catch {
      // fs.watch unavailable or path bad — silently rely on safety poll
    }
  }

  private stopWatcher(): void {
    if (this.watcher) {
      try {
        this.watcher.close();
      } catch {}
      this.watcher = null;
    }
  }

  private scheduleRePoll(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.poll();
    }, WATCH_DEBOUNCE_MS);
  }

  async requestDiff(projectId: string, file: string, kind: DiffKind): Promise<DiffResult | null> {
    const project = this.projectStore.list().find((p) => p.id === projectId);
    if (!project) return null;
    return this.getDiff(project.cwd, file, kind);
  }

  async stage(projectId: string, files: string[]): Promise<{ ok: boolean; error?: string }> {
    return this.runAction(projectId, ['add', '--', ...files]);
  }

  async unstage(projectId: string, files: string[]): Promise<{ ok: boolean; error?: string }> {
    return this.runAction(projectId, ['restore', '--staged', '--', ...files]);
  }

  async discard(
    projectId: string,
    trackedFiles: string[],
    untrackedFiles: string[],
  ): Promise<{ ok: boolean; error?: string }> {
    const project = this.projectStore.list().find((p) => p.id === projectId);
    if (!project) return { ok: false, error: 'project not found' };
    try {
      if (trackedFiles.length > 0) {
        await execFileP('git', ['restore', '--staged', '--worktree', '--', ...trackedFiles], {
          cwd: project.cwd,
          timeout: ACTION_TIMEOUT_MS,
        });
      }
      if (untrackedFiles.length > 0) {
        await execFileP('git', ['clean', '-f', '--', ...untrackedFiles], {
          cwd: project.cwd,
          timeout: ACTION_TIMEOUT_MS,
        });
      }
      this.poll();
      return { ok: true };
    } catch (e: unknown) {
      return { ok: false, error: (e as Error).message };
    }
  }

  async commit(projectId: string, message: string): Promise<{ ok: boolean; error?: string }> {
    if (!message.trim()) return { ok: false, error: 'commit message is empty' };
    return this.runAction(projectId, ['commit', '-m', message]);
  }

  private async runAction(
    projectId: string,
    args: string[],
  ): Promise<{ ok: boolean; error?: string }> {
    const project = this.projectStore.list().find((p) => p.id === projectId);
    if (!project) return { ok: false, error: 'project not found' };
    try {
      await execFileP('git', args, { cwd: project.cwd, timeout: ACTION_TIMEOUT_MS });
      this.poll();
      return { ok: true };
    } catch (e: unknown) {
      return { ok: false, error: (e as Error).message };
    }
  }

  private async poll(): Promise<void> {
    if (this.destroyed || this.polling) return;
    const projectId = this.activeProjectId;
    if (!projectId) return;
    this.polling = true;
    try {
      const project = this.projectStore.list().find((p) => p.id === projectId);
      if (!project) {
        if (this.lastStatus !== null) {
          this.lastStatus = null;
          this.onStatus(projectId, null);
        }
        return;
      }
      const status = await this.getStatus(project.cwd);
      if (this.destroyed || this.activeProjectId !== projectId) return;
      if (this.statusEqual(status, this.lastStatus)) return;
      this.lastStatus = status;
      this.onStatus(projectId, status);
    } catch {
      // Swallow — leave previous state in place
    } finally {
      this.polling = false;
    }
  }

  private async getStatus(cwd: string): Promise<SourceControlStatus | null> {
    try {
      const { stdout } = await execFileP(
        'git',
        ['status', '--porcelain=v2', '--untracked-files=all'],
        { cwd, timeout: 3000, maxBuffer: 4 * 1024 * 1024 },
      );
      return this.parseStatus(stdout);
    } catch {
      return null;
    }
  }

  private parseStatus(stdout: string): SourceControlStatus {
    const staged: SourceControlEntry[] = [];
    const changes: SourceControlEntry[] = [];
    const untracked: SourceControlEntry[] = [];
    const conflicted: SourceControlEntry[] = [];

    for (const line of stdout.split('\n')) {
      if (line.length === 0) continue;
      if (line.startsWith('# ')) continue;

      if (line.startsWith('? ')) {
        untracked.push({ path: line.slice(2), status: '?' });
        continue;
      }

      if (line.startsWith('! ')) continue;

      if (line.startsWith('1 ')) {
        // 1 XY sub mH mI mW hH hI <path>
        const m = line.match(/^1 (\S\S) \S+ \S+ \S+ \S+ \S+ \S+ (.+)$/);
        if (!m) continue;
        const xy = m[1];
        const path = m[2];
        const x = xy[0];
        const y = xy[1];
        if (x !== '.' && x !== ' ') {
          staged.push({ path, status: x as EntryStatus });
        }
        if (y !== '.' && y !== ' ') {
          changes.push({ path, status: y as EntryStatus });
        }
        continue;
      }

      if (line.startsWith('2 ')) {
        // 2 XY sub mH mI mW hH hI Xscore <path>\t<origPath>
        const m = line.match(/^2 (\S\S) \S+ \S+ \S+ \S+ \S+ \S+ \S+ (.+)$/);
        if (!m) continue;
        const xy = m[1];
        const rest = m[2];
        const tabIdx = rest.indexOf('\t');
        const path = tabIdx >= 0 ? rest.slice(0, tabIdx) : rest;
        const oldPath = tabIdx >= 0 ? rest.slice(tabIdx + 1) : undefined;
        const x = xy[0];
        const y = xy[1];
        if (x !== '.' && x !== ' ') {
          staged.push({ path, oldPath, status: x as EntryStatus });
        }
        if (y !== '.' && y !== ' ') {
          changes.push({ path, oldPath, status: y as EntryStatus });
        }
        continue;
      }

      if (line.startsWith('u ')) {
        // u XY sub m1 m2 m3 mW h1 h2 h3 <path>
        const m = line.match(/^u \S\S \S+ \S+ \S+ \S+ \S+ \S+ \S+ \S+ (.+)$/);
        if (!m) continue;
        conflicted.push({ path: m[1], status: 'U' });
        continue;
      }
    }

    return { staged, changes, untracked, conflicted };
  }

  private async getDiff(cwd: string, file: string, kind: DiffKind): Promise<DiffResult> {
    let args: string[];
    if (kind === 'staged') {
      args = ['diff', FULL_CONTEXT_FLAG, '--cached', '--', file];
    } else if (kind === 'untracked') {
      // Show the file's full contents as an all-additions diff
      args = ['diff', FULL_CONTEXT_FLAG, '--no-index', '--', '/dev/null', file];
    } else {
      args = ['diff', FULL_CONTEXT_FLAG, '--', file];
    }

    try {
      const { stdout } = await execFileP('git', args, {
        cwd,
        timeout: DIFF_TIMEOUT_MS,
        maxBuffer: DIFF_MAX_BYTES + 1024,
      });
      const truncated = stdout.length >= DIFF_MAX_BYTES;
      const diff = truncated ? stdout.slice(0, DIFF_MAX_BYTES) : stdout;
      const binary = /^Binary files .* differ$/m.test(diff);
      return { diff, binary, truncated };
    } catch (e: unknown) {
      // `git diff --no-index` exits 1 when files differ — still valid output
      const err = e as { stdout?: string; code?: number };
      if (err.stdout !== undefined && (err.code === 1 || kind === 'untracked')) {
        const truncated = err.stdout.length >= DIFF_MAX_BYTES;
        const diff = truncated ? err.stdout.slice(0, DIFF_MAX_BYTES) : err.stdout;
        const binary = /^Binary files .* differ$/m.test(diff);
        return { diff, binary, truncated };
      }
      return { diff: '', binary: false, truncated: false };
    }
  }

  private statusEqual(a: SourceControlStatus | null, b: SourceControlStatus | null): boolean {
    if (a === b) return true;
    if (!a || !b) return false;
    return (
      this.entriesEqual(a.staged, b.staged) &&
      this.entriesEqual(a.changes, b.changes) &&
      this.entriesEqual(a.untracked, b.untracked) &&
      this.entriesEqual(a.conflicted, b.conflicted)
    );
  }

  private entriesEqual(a: SourceControlEntry[], b: SourceControlEntry[]): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i].path !== b[i].path) return false;
      if (a[i].status !== b[i].status) return false;
      if (a[i].oldPath !== b[i].oldPath) return false;
    }
    return true;
  }
}
