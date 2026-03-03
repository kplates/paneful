import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { PtyManager } from './pty-manager.js';
import type { ProjectStore } from './project-store.js';

type ClaudeStatus = 'active' | 'idle';

// If the latest JSONL mtime is < 5s ago, Claude is actively working.
// Otherwise Claude is open but idle (waiting for user input).
const ACTIVE_THRESHOLD = 5_000;

export class ClaudeMonitor {
  private claudeDir: string;
  private ptyManager: PtyManager;
  private projectStore: ProjectStore;
  private onChange: (statuses: Record<string, ClaudeStatus>) => void;
  private prevStatuses: Record<string, ClaudeStatus> = {};
  private cachedLatestFile = new Map<string, string>(); // cwd → latest .jsonl path
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private destroyed = false;

  constructor(
    ptyManager: PtyManager,
    projectStore: ProjectStore,
    onChange: (statuses: Record<string, ClaudeStatus>) => void,
  ) {
    this.ptyManager = ptyManager;
    this.projectStore = projectStore;
    this.onChange = onChange;
    this.claudeDir = path.join(os.homedir(), '.claude', 'projects');
  }

  start(): void {
    this.pollTimer = setInterval(() => this.poll(), 3000);
  }

  destroy(): void {
    this.destroyed = true;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private poll(): void {
    if (this.destroyed) return;

    // Step 1: Ask pty-manager which projects have `claude` as foreground process
    const claudeProjects = this.ptyManager.getClaudeProjects();

    // Step 2: For each, determine active vs idle by checking JSONL mtime
    const statuses: Record<string, ClaudeStatus> = {};
    for (const projectId of claudeProjects) {
      const project = this.projectStore.get(projectId);
      if (!project) continue;

      const status = this.checkMtime(project.cwd) ? 'active' : 'idle';
      statuses[projectId] = status;
    }

    // Step 3: Only notify if something changed
    if (!this.statusesEqual(statuses)) {
      this.prevStatuses = statuses;
      this.onChange(statuses);
    }
  }

  /** Returns true if the project's latest JSONL was modified within ACTIVE_THRESHOLD. */
  private checkMtime(cwd: string): boolean {
    // Fast path: stat only the cached latest file
    const cached = this.cachedLatestFile.get(cwd);
    if (cached) {
      try {
        const stat = fs.statSync(cached);
        if ((Date.now() - stat.mtimeMs) < ACTIVE_THRESHOLD) return true;
      } catch {
        // File gone — fall through to full scan
        this.cachedLatestFile.delete(cwd);
      }
    }

    // Full scan: find the latest .jsonl (runs once on first check, then only
    // when the cached file is stale — i.e. Claude started a new session)
    const folder = path.join(this.claudeDir, cwd.replace(/\//g, '-'));
    try {
      const files = fs.readdirSync(folder).filter((f) => f.endsWith('.jsonl'));
      let maxMtime = 0;
      let maxFile = '';
      for (const file of files) {
        try {
          const filePath = path.join(folder, file);
          const stat = fs.statSync(filePath);
          if (stat.mtimeMs > maxMtime) {
            maxMtime = stat.mtimeMs;
            maxFile = filePath;
          }
        } catch {
          // skip
        }
      }
      if (maxFile) this.cachedLatestFile.set(cwd, maxFile);
      return maxMtime > 0 && (Date.now() - maxMtime) < ACTIVE_THRESHOLD;
    } catch {
      return false;
    }
  }

  private statusesEqual(next: Record<string, ClaudeStatus>): boolean {
    const prevKeys = Object.keys(this.prevStatuses);
    const nextKeys = Object.keys(next);
    if (prevKeys.length !== nextKeys.length) return false;
    for (const key of nextKeys) {
      if (this.prevStatuses[key] !== next[key]) return false;
    }
    return true;
  }
}
