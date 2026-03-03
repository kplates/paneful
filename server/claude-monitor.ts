import type { PtyManager } from './pty-manager.js';

type ClaudeStatus = 'active' | 'idle';

// Terminal had output within this window → Claude is actively working
const ACTIVE_THRESHOLD = 3_000;

export class ClaudeMonitor {
  private ptyManager: PtyManager;
  private onChange: (statuses: Record<string, ClaudeStatus>) => void;
  private lastOutput = new Map<string, number>(); // terminalId → timestamp
  private prevStatuses: Record<string, ClaudeStatus> = {};
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private destroyed = false;

  constructor(
    ptyManager: PtyManager,
    onChange: (statuses: Record<string, ClaudeStatus>) => void,
  ) {
    this.ptyManager = ptyManager;
    this.onChange = onChange;
  }

  start(): void {
    this.pollTimer = setInterval(() => this.poll(), 3000);
  }

  /** Call from the PTY output path to record activity. */
  recordOutput(terminalId: string): void {
    this.lastOutput.set(terminalId, Date.now());
  }

  /** Clean up when a terminal is removed. */
  removeTerminal(terminalId: string): void {
    this.lastOutput.delete(terminalId);
  }

  destroy(): void {
    this.destroyed = true;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.lastOutput.clear();
  }

  private poll(): void {
    if (this.destroyed) return;

    const now = Date.now();
    const agentProjects = this.ptyManager.getAgentProjects();
    const statuses: Record<string, ClaudeStatus> = {};

    for (const [projectId, terminalIds] of agentProjects) {
      let latestOutput = 0;
      for (const tid of terminalIds) {
        const ts = this.lastOutput.get(tid) ?? 0;
        if (ts > latestOutput) latestOutput = ts;
      }
      statuses[projectId] = (latestOutput > 0 && (now - latestOutput) < ACTIVE_THRESHOLD)
        ? 'active'
        : 'idle';
    }

    if (!this.statusesEqual(statuses)) {
      this.prevStatuses = statuses;
      this.onChange(statuses);
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
