import * as pty from 'node-pty';
import os from 'node:os';

interface ManagedPty {
  process: pty.IPty;
  projectId: string;
}

export type PtyOutputCallback = (terminalId: string, data: string) => void;
export type PtyExitCallback = (terminalId: string, exitCode: number) => void;

export class PtyManager {
  private sessions: Map<string, ManagedPty> = new Map();

  spawn(
    terminalId: string,
    projectId: string,
    cwd: string,
    onOutput: PtyOutputCallback,
    onExit: PtyExitCallback,
  ): void {
    const shell = process.env.SHELL || (os.platform() === 'win32' ? 'powershell.exe' : '/bin/bash');

    // Filter out undefined values from process.env before spreading
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (v !== undefined) env[k] = v;
    }
    env.TERM = 'xterm-256color';
    env.LANG = 'en_US.UTF-8';
    env.LC_ALL = 'en_US.UTF-8';

    const proc = pty.spawn(shell, ['--login'], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd,
      env,
    });

    proc.onData((data: string) => {
      onOutput(terminalId, data);
    });

    proc.onExit(({ exitCode }) => {
      this.sessions.delete(terminalId);
      onExit(terminalId, exitCode);
    });

    this.sessions.set(terminalId, { process: proc, projectId });
  }

  write(terminalId: string, data: string): void {
    const managed = this.sessions.get(terminalId);
    if (managed) {
      managed.process.write(data);
    }
  }

  resize(terminalId: string, cols: number, rows: number): void {
    const managed = this.sessions.get(terminalId);
    if (managed) {
      managed.process.resize(cols, rows);
    }
  }

  kill(terminalId: string): string | undefined {
    const managed = this.sessions.get(terminalId);
    if (managed) {
      managed.process.kill();
      this.sessions.delete(terminalId);
      return managed.projectId;
    }
    return undefined;
  }

  killProject(projectId: string): string[] {
    const killed: string[] = [];
    for (const [id, managed] of this.sessions) {
      if (managed.projectId === projectId) {
        managed.process.kill();
        killed.push(id);
      }
    }
    for (const id of killed) {
      this.sessions.delete(id);
    }
    return killed;
  }

  killAll(): void {
    for (const [, managed] of this.sessions) {
      managed.process.kill();
    }
    this.sessions.clear();
  }

  terminalExists(terminalId: string): boolean {
    return this.sessions.has(terminalId);
  }

  /** Returns projectId → terminalIds[] for terminals running an AI coding agent. */
  getAgentProjects(): Map<string, string[]> {
    const result = new Map<string, string[]>();
    for (const [terminalId, managed] of this.sessions) {
      try {
        const proc = managed.process.process;
        if (proc === 'claude' || proc.startsWith('codex')) {
          const list = result.get(managed.projectId);
          if (list) list.push(terminalId);
          else result.set(managed.projectId, [terminalId]);
        }
      } catch {
        // PTY may have been killed
      }
    }
    return result;
  }
}
