import { WebSocket, WebSocketServer } from 'ws';
import type { Server } from 'node:http';
import { PtyManager } from './pty-manager.js';
import { ProjectStore, newProject } from './project-store.js';
import { PortMonitor } from './port-monitor.js';
import { ClaudeMonitor } from './claude-monitor.js';

// Client → Server
type ClientMessage =
  | { type: 'pty:spawn'; terminalId: string; projectId: string; cwd: string }
  | { type: 'pty:input'; terminalId: string; data: string }
  | { type: 'pty:resize'; terminalId: string; cols: number; rows: number }
  | { type: 'pty:kill'; terminalId: string }
  | { type: 'project:kill'; projectId: string }
  | { type: 'project:create'; projectId: string; name: string; cwd: string }
  | { type: 'project:remove'; projectId: string };

// Server → Client
type ServerMessage =
  | { type: 'pty:output'; terminalId: string; data: string }
  | { type: 'pty:exit'; terminalId: string; exitCode: number }
  | { type: 'project:spawned'; projectId: string; name: string; cwd: string }
  | { type: 'editor:active'; projectName: string }
  | { type: 'port:status'; ports: Record<string, number[]> }
  | { type: 'claude:status'; statuses: Record<string, 'active' | 'idle'> }
  | { type: 'error'; message: string };

export interface WsHandlerOptions {
  onIdle?: () => void;
}

export class WsHandler {
  private wss: WebSocketServer;
  private client: WebSocket | null = null;
  private ptyManager: PtyManager;
  private projectStore: ProjectStore;
  private portMonitor: PortMonitor;
  private claudeMonitor: ClaudeMonitor;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private onIdle?: () => void;

  constructor(server: Server, ptyManager: PtyManager, projectStore: ProjectStore, options?: WsHandlerOptions) {
    this.ptyManager = ptyManager;
    this.projectStore = projectStore;
    this.onIdle = options?.onIdle;
    this.portMonitor = new PortMonitor((ports) => {
      this.send({ type: 'port:status', ports });
    });
    this.claudeMonitor = new ClaudeMonitor(ptyManager, projectStore, (statuses) => {
      this.send({ type: 'claude:status', statuses });
    });
    this.claudeMonitor.start();

    this.wss = new WebSocketServer({ noServer: true });

    server.on('upgrade', (req, socket, head) => {
      if (req.url === '/ws') {
        this.wss.handleUpgrade(req, socket, head, (ws) => {
          this.wss.emit('connection', ws, req);
        });
      } else {
        socket.destroy();
      }
    });

    this.wss.on('connection', (ws) => {
      this.client = ws;
      if (this.idleTimer) {
        clearTimeout(this.idleTimer);
        this.idleTimer = null;
      }
      console.log('WebSocket client connected');

      ws.on('message', (raw) => {
        try {
          const msg: ClientMessage = JSON.parse(raw.toString());
          this.handleMessage(msg);
        } catch (e) {
          this.send({ type: 'error', message: `Invalid message: ${e}` });
        }
      });

      ws.on('close', () => {
        console.log('WebSocket client disconnected');
        this.client = null;
        this.startIdleTimer();
      });

      ws.on('error', (err) => {
        console.error('WebSocket error:', err.message);
        this.client = null;
        this.startIdleTimer();
      });
    });
  }

  private startIdleTimer(): void {
    if (!this.onIdle) return;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      // Only fire if still no clients connected
      if (!this.client || this.client.readyState !== WebSocket.OPEN) {
        console.log('No clients connected for 5 seconds, shutting down...');
        this.onIdle!();
      }
    }, 5000);
  }

  send(msg: ServerMessage): void {
    if (this.client && this.client.readyState === WebSocket.OPEN) {
      this.client.send(JSON.stringify(msg));
    }
  }

  private handleMessage(msg: ClientMessage): void {
    switch (msg.type) {
      case 'pty:spawn':
        this.handlePtySpawn(msg.terminalId, msg.projectId, msg.cwd);
        break;

      case 'pty:input':
        this.ptyManager.write(msg.terminalId, msg.data);
        break;

      case 'pty:resize':
        this.ptyManager.resize(msg.terminalId, msg.cols, msg.rows);
        break;

      case 'pty:kill': {
        this.portMonitor.removeTerminal(msg.terminalId);
        const projectId = this.ptyManager.kill(msg.terminalId);
        if (projectId) {
          this.projectStore.removeTerminal(projectId, msg.terminalId);
          this.send({ type: 'pty:exit', terminalId: msg.terminalId, exitCode: 0 });
        }
        break;
      }

      case 'project:kill': {
        this.portMonitor.removeProject(msg.projectId);
        const killed = this.ptyManager.killProject(msg.projectId);
        for (const tid of killed) {
          this.send({ type: 'pty:exit', terminalId: tid, exitCode: 0 });
        }
        break;
      }

      case 'project:create': {
        const project = newProject(msg.projectId, msg.name, msg.cwd);
        this.projectStore.create(project);
        break;
      }

      case 'project:remove': {
        this.portMonitor.removeProject(msg.projectId);
        const killed = this.ptyManager.killProject(msg.projectId);
        for (const tid of killed) {
          this.send({ type: 'pty:exit', terminalId: tid, exitCode: 0 });
        }
        this.projectStore.remove(msg.projectId);
        break;
      }
    }
  }

  destroy(): void {
    this.portMonitor.destroy();
    this.claudeMonitor.destroy();
  }

  private handlePtySpawn(terminalId: string, projectId: string, cwd: string): void {
    try {
      this.ptyManager.spawn(
        terminalId,
        projectId,
        cwd,
        (tid, data) => {
          this.send({ type: 'pty:output', terminalId: tid, data });
          this.portMonitor.scanOutput(tid, projectId, data);
        },
        (tid, exitCode) => {
          this.portMonitor.removeTerminal(tid);
          this.send({ type: 'pty:exit', terminalId: tid, exitCode });
        },
      );
      this.projectStore.addTerminal(projectId, terminalId);
    } catch (e) {
      this.send({ type: 'error', message: `Failed to spawn terminal: ${e}` });
    }
  }
}
