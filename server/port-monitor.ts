import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { PtyManager } from './pty-manager.js';

const execFileP = promisify(execFile);

interface Listener {
  pid: number;
  port: number;
}

export class PortMonitor {
  private ptyManager: PtyManager;
  private onChange: (ports: Record<string, number[]>) => void;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private prevPorts: Record<string, number[]> = {};
  private destroyed = false;
  private polling = false;

  constructor(
    ptyManager: PtyManager,
    onChange: (ports: Record<string, number[]>) => void,
  ) {
    this.ptyManager = ptyManager;
    this.onChange = onChange;
  }

  resume(): void {
    if (this.destroyed || this.pollTimer) return;
    this.pollTimer = setInterval(() => this.poll(), 3_000);
    this.poll();
  }

  pause(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  getPortStatus(): Record<string, number[]> {
    return { ...this.prevPorts };
  }

  destroy(): void {
    this.destroyed = true;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private async poll(): Promise<void> {
    if (this.destroyed || this.polling) return;
    this.polling = true;
    try {
      await this.doPoll();
    } catch {
      // Swallow poll errors so a transient ps/lsof hiccup doesn't kill the loop
    } finally {
      this.polling = false;
    }
  }

  private async doPoll(): Promise<void> {
    const ptys = this.ptyManager.getProjectPids();
    if (ptys.length === 0) {
      this.updateAndNotify({});
      return;
    }

    const [tree, listeners] = await Promise.all([
      this.getProcessTree(),
      this.getListeners(),
    ]);

    if (this.destroyed) return;

    const result: Record<string, Set<number>> = {};
    for (const { pid, projectId } of ptys) {
      const desc = this.descendants(pid, tree);
      for (const { pid: listenerPid, port } of listeners) {
        if (desc.has(listenerPid)) {
          if (!result[projectId]) result[projectId] = new Set();
          result[projectId].add(port);
        }
      }
    }

    const final: Record<string, number[]> = {};
    for (const [projectId, set] of Object.entries(result)) {
      final[projectId] = [...set].sort((a, b) => a - b);
    }
    this.updateAndNotify(final);
  }

  private updateAndNotify(next: Record<string, number[]>): void {
    if (this.portsEqual(next, this.prevPorts)) return;
    this.prevPorts = next;
    this.onChange(next);
  }

  private portsEqual(
    a: Record<string, number[]>,
    b: Record<string, number[]>,
  ): boolean {
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length) return false;
    for (const key of aKeys) {
      const av = a[key];
      const bv = b[key];
      if (!bv || av.length !== bv.length) return false;
      for (let i = 0; i < av.length; i++) {
        if (av[i] !== bv[i]) return false;
      }
    }
    return true;
  }

  private async getProcessTree(): Promise<Map<number, number[]>> {
    const { stdout } = await execFileP('ps', ['-A', '-o', 'pid=,ppid=']);
    const children = new Map<number, number[]>();
    for (const line of stdout.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const match = trimmed.match(/^(\d+)\s+(\d+)$/);
      if (!match) continue;
      const pid = parseInt(match[1], 10);
      const ppid = parseInt(match[2], 10);
      const list = children.get(ppid);
      if (list) list.push(pid);
      else children.set(ppid, [pid]);
    }
    return children;
  }

  private descendants(root: number, tree: Map<number, number[]>): Set<number> {
    const result = new Set<number>([root]);
    const stack: number[] = [root];
    while (stack.length > 0) {
      const pid = stack.pop()!;
      const kids = tree.get(pid);
      if (!kids) continue;
      for (const kid of kids) {
        if (!result.has(kid)) {
          result.add(kid);
          stack.push(kid);
        }
      }
    }
    return result;
  }

  private async getListeners(): Promise<Listener[]> {
    // lsof exits non-zero when there are no matches — read stdout from the error anyway
    let stdout = '';
    try {
      const result = await execFileP('lsof', [
        '-nP',
        '-iTCP',
        '-sTCP:LISTEN',
        '-F',
        'pn',
      ]);
      stdout = result.stdout;
    } catch (e: unknown) {
      const err = e as { stdout?: string };
      stdout = err.stdout ?? '';
    }

    const out: Listener[] = [];
    let currentPid: number | null = null;
    for (const line of stdout.split('\n')) {
      if (line.length === 0) continue;
      const tag = line[0];
      const value = line.slice(1);
      if (tag === 'p') {
        const pid = parseInt(value, 10);
        currentPid = Number.isFinite(pid) ? pid : null;
      } else if (tag === 'n' && currentPid !== null) {
        // Address forms: *:3000, 127.0.0.1:3000, [::1]:3000
        const portMatch = value.match(/:(\d+)$/);
        if (!portMatch) continue;
        const port = parseInt(portMatch[1], 10);
        if (port > 0 && port <= 65535) {
          out.push({ pid: currentPid, port });
        }
      }
    }
    return out;
  }
}
