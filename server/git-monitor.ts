import { execFile } from 'node:child_process';
import type { ProjectStore } from './project-store.js';

export class GitMonitor {
  private projectStore: ProjectStore;
  private onChange: (branches: Record<string, string | null>) => void;
  private branches = new Map<string, string | null>();
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private destroyed = false;

  constructor(projectStore: ProjectStore, onChange: (branches: Record<string, string | null>) => void) {
    this.projectStore = projectStore;
    this.onChange = onChange;
    this.poll();
    this.pollTimer = setInterval(() => this.poll(), 10_000);
  }

  getBranches(): Record<string, string | null> {
    const result: Record<string, string | null> = {};
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
    if (this.destroyed) return;

    const projects = this.projectStore.list();
    const results = await Promise.all(
      projects.map((p) => this.getBranch(p.cwd).then((branch) => [p.id, branch] as const))
    );

    if (this.destroyed) return;

    const newBranches = new Map<string, string | null>();
    for (const [id, branch] of results) {
      newBranches.set(id, branch);
    }

    // Check if changed
    if (this.mapsEqual(newBranches)) return;
    this.branches = newBranches;
    this.notify();
  }

  private getBranch(cwd: string): Promise<string | null> {
    return new Promise((resolve) => {
      execFile('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd, timeout: 2000 }, (err, stdout) => {
        if (err) {
          resolve(null);
          return;
        }
        const branch = stdout.trim();
        resolve(branch || null);
      });
    });
  }

  private mapsEqual(other: Map<string, string | null>): boolean {
    if (other.size !== this.branches.size) return false;
    for (const [key, val] of other) {
      if (this.branches.get(key) !== val) return false;
    }
    return true;
  }

  private notify(): void {
    const result: Record<string, string | null> = {};
    for (const [id, branch] of this.branches) {
      result[id] = branch;
    }
    this.onChange(result);
  }
}
