import * as pty from 'node-pty';
import { execSync } from 'node:child_process';
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
    command?: string,
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

    // Command mode: run the command in the user's own login+interactive shell,
    // then drop back into an interactive shell so the PTY stays alive (matches
    // Terminal.app behavior). We use `-l -i` so both profile AND rc files
    // (e.g. ~/.zshrc) are sourced — that's where user-installed binaries
    // like `claude`, `nvm`-managed `node`, etc. land on PATH.
    //
    // Passing the command via $0 + eval keeps the user's command opaque to the
    // wrapper script's quoting.
    const wrapper = `eval "$0"; printf '\\r\\n\\033[90m[paneful: command finished — type exit to close this run]\\033[0m\\r\\n'; exec "$1" -i -l`;
    const isCommandMode = !!command;
    // bash and zsh both accept -l -i -c SCRIPT ARG ARG. Fish doesn't, so fall back to bash.
    const wrapperShell = /\/(bash|zsh)$/.test(shell) ? shell : '/bin/bash';
    const args = isCommandMode
      ? ['-l', '-i', '-c', wrapper, command as string, shell]
      : ['--login'];
    const proc = pty.spawn(isCommandMode ? wrapperShell : shell, args, {
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

  /**
   * Pauses the PTY by sending SIGSTOP to its process group. The shell and its
   * descendants freeze in place — no CPU, no I/O — and their in-memory state
   * is preserved until `cont()` is called.
   */
  pause(terminalId: string): boolean {
    const managed = this.sessions.get(terminalId);
    if (!managed) return false;
    return signalPty(managed.process.pid, 'SIGSTOP');
  }

  /**
   * Continues a paused PTY (SIGCONT). The process picks up exactly where it was.
   */
  cont(terminalId: string): boolean {
    const managed = this.sessions.get(terminalId);
    if (!managed) return false;
    return signalPty(managed.process.pid, 'SIGCONT');
  }

  terminalExists(terminalId: string): boolean {
    return this.sessions.has(terminalId);
  }

  /** Returns {pid, projectId} for every active PTY. Used to attribute listening sockets to projects. */
  getProjectPids(): Array<{ pid: number; projectId: string }> {
    const result: Array<{ pid: number; projectId: string }> = [];
    for (const managed of this.sessions.values()) {
      try {
        result.push({ pid: managed.process.pid, projectId: managed.projectId });
      } catch {
        // PTY may have been killed
      }
    }
    return result;
  }

  /** Returns projectId → terminalIds[] for terminals running an AI coding agent. */
  getAgentProjects(): Map<string, string[]> {
    const result = new Map<string, string[]>();
    for (const [terminalId, managed] of this.sessions) {
      try {
        const proc = managed.process.process;
        const isAgent = proc === 'claude' || proc === 'aider' || proc.startsWith('codex')
          || (RUNTIME_PROCESSES.has(proc) && this.checkChildCmdline(managed.process.pid));
        if (isAgent) {
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

  /** Check if any child process of the shell is a known AI agent. */
  private checkChildCmdline(shellPid: number): boolean {
    try {
      const childPids = execSync(`pgrep -P ${shellPid}`, { encoding: 'utf8', timeout: 1000 })
        .trim().split('\n').filter(Boolean);
      if (childPids.length === 0) return false;
      for (const pid of childPids) {
        const cmdline = execSync(`ps -o args= -p ${pid}`, { encoding: 'utf8', timeout: 1000 }).trim();
        if (AGENT_CMD_PATTERN.test(cmdline)) return true;
      }
      return false;
    } catch {
      return false;
    }
  }
}

const RUNTIME_PROCESSES = new Set(['node', 'python', 'python3']);
// Match agent binary names at the end of a path or as a standalone token
const AGENT_CMD_PATTERN = /(?:^|\/)(codex|claude|aider)(?:\s|$)/;

// Signal the PTY's whole process group (negative pid) so children pause/continue with it.
// Falls back to single-process if the group signal fails (unlikely on macOS).
function signalPty(pid: number, signal: NodeJS.Signals): boolean {
  try {
    process.kill(-pid, signal);
    return true;
  } catch {
    try {
      process.kill(pid, signal);
      return true;
    } catch {
      return false;
    }
  }
}
