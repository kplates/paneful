import net from "node:net";

// Strip ANSI escape codes from PTY output
const ANSI_RE =
  /\x1b\[[0-9;]*[a-zA-Z]|\x1b\].*?(?:\x07|\x1b\\)|\x1b[()][0-9A-B]/g;

// Match dev-server URLs like http://localhost:3000, http://127.0.0.1:8080, etc.
const PORT_RE =
  /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[?::1?\]?):(\d{1,5})/g;

interface TerminalInfo {
  projectId: string;
  ports: Set<number>;
  lineBuffer: string;
}

export class PortMonitor {
  private terminals = new Map<string, TerminalInfo>();
  private alivePorts = new Map<string, Set<number>>(); // projectId → alive ports
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private immediatePollTimer: ReturnType<typeof setTimeout> | null = null;
  private onChange: (ports: Record<string, number[]>) => void;
  private destroyed = false;
  private polling = false;
  private paused = true;

  constructor(onChange: (ports: Record<string, number[]>) => void) {
    this.onChange = onChange;
  }

  resume(): void {
    if (this.destroyed || !this.paused) return;
    this.paused = false;
    this.pollTimer = setInterval(() => this.poll(), 10_000);
  }

  pause(): void {
    this.paused = true;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.immediatePollTimer) {
      clearTimeout(this.immediatePollTimer);
      this.immediatePollTimer = null;
    }
  }

  getPortStatus(): Record<string, number[]> {
    const result: Record<string, number[]> = {};
    for (const [pid, ports] of this.alivePorts) {
      result[pid] = [...ports];
    }
    return result;
  }

  scanOutput(terminalId: string, projectId: string, data: string): void {
    if (this.destroyed) return;

    let info = this.terminals.get(terminalId);
    if (!info) {
      info = { projectId, ports: new Set(), lineBuffer: "" };
      this.terminals.set(terminalId, info);
    }

    // Already found ports for this terminal — skip scanning.
    // If the port goes down, the poll scrubs it from info.ports,
    // so scanning resumes automatically on restart.
    if (info.ports.size > 0) return;

    // Strip ANSI codes from just the new chunk, then append to line buffer
    const clean = data.replace(ANSI_RE, "");
    const combined = info.lineBuffer + clean;
    const lines = combined.split(/\r?\n/);

    // Keep last incomplete line in buffer, capped to prevent unbounded growth
    const tail = lines.pop() ?? "";
    info.lineBuffer = tail.length > 512 ? tail.slice(-512) : tail;

    let found = false;
    for (const line of lines) {
      PORT_RE.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = PORT_RE.exec(line)) !== null) {
        const port = parseInt(match[1], 10);
        if (port > 0 && port <= 65535 && !info.ports.has(port)) {
          info.ports.add(port);
          found = true;
        }
      }
    }

    // Also scan the buffer (for single-line output without trailing newline)
    PORT_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = PORT_RE.exec(info.lineBuffer)) !== null) {
      const port = parseInt(match[1], 10);
      if (port > 0 && port <= 65535 && !info.ports.has(port)) {
        info.ports.add(port);
        found = true;
      }
    }

    if (found && !this.paused) {
      if (this.immediatePollTimer) clearTimeout(this.immediatePollTimer);
      this.immediatePollTimer = setTimeout(() => this.poll(), 500);
    }
  }

  removeTerminal(terminalId: string): void {
    const info = this.terminals.get(terminalId);
    if (!info) return;
    this.terminals.delete(terminalId);
    this.rebuildAndNotify();
  }

  removeProject(projectId: string): void {
    for (const [tid, info] of this.terminals) {
      if (info.projectId === projectId) {
        this.terminals.delete(tid);
      }
    }
    const hadPorts = this.alivePorts.has(projectId);
    this.alivePorts.delete(projectId);
    if (hadPorts) {
      this.notify();
    }
  }

  destroy(): void {
    this.destroyed = true;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.immediatePollTimer) {
      clearTimeout(this.immediatePollTimer);
      this.immediatePollTimer = null;
    }
    this.terminals.clear();
    this.alivePorts.clear();
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

    // Build projectId → Set<port> from all terminals
    const projectPorts = new Map<string, Set<number>>();
    for (const info of this.terminals.values()) {
      if (info.ports.size === 0) continue;
      let set = projectPorts.get(info.projectId);
      if (!set) {
        set = new Set();
        projectPorts.set(info.projectId, set);
      }
      for (const p of info.ports) set.add(p);
    }

    // TCP-probe each unique port
    const uniquePorts = new Set<number>();
    for (const set of projectPorts.values()) {
      for (const p of set) uniquePorts.add(p);
    }

    const probeResults = new Map<number, boolean>();
    await Promise.all(
      [...uniquePorts].map(
        (port) =>
          new Promise<void>((resolve) => {
            // Try IPv4 first, fall back to IPv6 (::1).
            // Many dev servers (Angular/Vite) bind to ::1 on macOS.
            const tryConnect = (host: string, fallback?: string) => {
              const sock = net.createConnection({ port, host }, () => {
                probeResults.set(port, true);
                sock.destroy();
                resolve();
              });
              sock.on("error", () => {
                if (fallback) {
                  tryConnect(fallback);
                } else {
                  probeResults.set(port, false);
                  resolve();
                }
              });
              sock.setTimeout(500, () => {
                sock.destroy();
                if (fallback) {
                  tryConnect(fallback);
                } else {
                  probeResults.set(port, false);
                  resolve();
                }
              });
            };
            tryConnect("127.0.0.1", "::1");
          }),
      ),
    );

    if (this.destroyed) return;

    // Scrub dead ports from terminal tracking so stale entries
    // don't cause overlap when another project reuses the same port
    for (const info of this.terminals.values()) {
      for (const p of info.ports) {
        if (!probeResults.get(p)) {
          info.ports.delete(p);
        }
      }
    }

    // Build new alive state
    const newAlive = new Map<string, Set<number>>();
    for (const [projectId, ports] of projectPorts) {
      const alive = new Set<number>();
      for (const p of ports) {
        if (probeResults.get(p)) alive.add(p);
      }
      if (alive.size > 0) {
        newAlive.set(projectId, alive);
      }
    }

    // Check if changed
    if (this.setsEqual(newAlive)) return;
    this.alivePorts = newAlive;
    this.notify();
  }

  private rebuildAndNotify(): void {
    // After terminal removal, re-poll immediately to update state
    this.poll();
  }

  private setsEqual(newAlive: Map<string, Set<number>>): boolean {
    if (newAlive.size !== this.alivePorts.size) return false;
    for (const [pid, ports] of newAlive) {
      const existing = this.alivePorts.get(pid);
      if (!existing || existing.size !== ports.size) return false;
      for (const p of ports) {
        if (!existing.has(p)) return false;
      }
    }
    return true;
  }

  private notify(): void {
    const result: Record<string, number[]> = {};
    for (const [pid, ports] of this.alivePorts) {
      result[pid] = [...ports];
    }
    this.onChange(result);
  }
}
