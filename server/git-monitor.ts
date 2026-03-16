import { execFile } from 'node:child_process';
import type { ProjectStore } from './project-store.js';

export interface GitStatus {
  branch: string;
  staged: number;
  modified: number;
  ahead: number;
  behind: number;
}

export class GitMonitor {
  private projectStore: ProjectStore;
  private onChange: (branches: Record<string, GitStatus | null>) => void;
  private branches = new Map<string, GitStatus | null>();
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private destroyed = false;
  private polling = false;

  constructor(projectStore: ProjectStore, onChange: (branches: Record<string, GitStatus | null>) => void) {
    this.projectStore = projectStore;
    this.onChange = onChange;
    // Initial poll to have data ready for first client connection
    this.poll();
  }

  resume(): void {
    if (this.destroyed || this.pollTimer) return;
    this.poll();
    this.pollTimer = setInterval(() => this.poll(), 10_000);
  }

  pause(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  getBranches(): Record<string, GitStatus | null> {
    const result: Record<string, GitStatus | null> = {};
    for (const [id, branch] of this.branches) {
      result[id] = branch;
    }
    return result;
  }

  destroy(): void {
    this.destroyed = true;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.branches.clear();
  }

  private async poll(): Promise<void> {
    if (this.destroyed || this.polling) return;
    this.polling = true;
    try {
      await this.doPoll();
    } finally {
      this.polling = false;
    }
  }

  private async doPoll(): Promise<void> {
    if (this.destroyed) return;

    const projects = this.projectStore.list();
    const results = await Promise.all(
      projects.map((p) => this.getStatus(p.cwd).then((status) => [p.id, status] as const))
    );

    if (this.destroyed) return;

    const newBranches = new Map<string, GitStatus | null>();
    for (const [id, status] of results) {
      newBranches.set(id, status);
    }

    // Check if changed
    if (this.mapsEqual(newBranches)) return;
    this.branches = newBranches;
    this.notify();
  }

  private getStatus(cwd: string): Promise<GitStatus | null> {
    return new Promise((resolve) => {
      execFile('git', ['status', '--porcelain', '-b'], { cwd, timeout: 3000 }, (err, stdout) => {
        if (err) {
          resolve(null);
          return;
        }
        resolve(this.parseStatus(stdout));
      });
    });
  }

  private parseStatus(output: string): GitStatus | null {
    const lines = output.split('\n').filter((l) => l.length > 0);
    if (lines.length === 0) return null;

    // Parse header line: ## branch...origin/branch [ahead N, behind M]
    const header = lines[0];
    let branch = '';
    let ahead = 0;
    let behind = 0;

    if (header.startsWith('## ')) {
      const rest = header.slice(3);
      // Extract ahead/behind from brackets
      const bracketMatch = rest.match(/\[(.+)\]/);
      if (bracketMatch) {
        const info = bracketMatch[1];
        const aheadMatch = info.match(/ahead (\d+)/);
        const behindMatch = info.match(/behind (\d+)/);
        if (aheadMatch) ahead = parseInt(aheadMatch[1], 10);
        if (behindMatch) behind = parseInt(behindMatch[1], 10);
      }
      // Extract branch name (before ... or end)
      const branchPart = rest.replace(/\s*\[.+\]/, '');
      const dotIdx = branchPart.indexOf('...');
      branch = dotIdx >= 0 ? branchPart.slice(0, dotIdx) : branchPart;
    }

    if (!branch || branch === 'No commits yet on') return null;
    // Handle "No commits yet on <branch>"
    if (branch.startsWith('No commits yet on ')) {
      branch = branch.slice('No commits yet on '.length);
    }

    // Parse file status lines
    let staged = 0;
    let modified = 0;
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (line.length < 2) continue;
      const x = line[0]; // index (staged)
      const y = line[1]; // worktree (modified)

      // Untracked files: count as modified
      if (x === '?' && y === '?') {
        modified++;
        continue;
      }

      // Staged: first char is not space or ?
      if (x !== ' ' && x !== '?') staged++;
      // Modified: second char is not space or ?
      if (y !== ' ' && y !== '?') modified++;
    }

    return { branch, staged, modified, ahead, behind };
  }

  private mapsEqual(other: Map<string, GitStatus | null>): boolean {
    if (other.size !== this.branches.size) return false;
    for (const [key, val] of other) {
      if (!this.branches.has(key)) return false;
      const cur = this.branches.get(key) ?? null;
      if (val === null && cur === null) continue;
      if (val === null || cur === null) return false;
      if (
        cur.branch !== val.branch ||
        cur.staged !== val.staged ||
        cur.modified !== val.modified ||
        cur.ahead !== val.ahead ||
        cur.behind !== val.behind
      ) return false;
    }
    return true;
  }

  private notify(): void {
    const result: Record<string, GitStatus | null> = {};
    for (const [id, branch] of this.branches) {
      result[id] = branch;
    }
    this.onChange(result);
  }
}
