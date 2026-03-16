import { WebSocket, WebSocketServer } from 'ws';
import type { Server } from 'node:http';
import { PtyManager } from './pty-manager.js';
import { ProjectStore, newProject } from './project-store.js';
import { PortMonitor } from './port-monitor.js';
import { ClaudeMonitor } from './claude-monitor.js';
import { GitMonitor, type GitStatus } from './git-monitor.js';
import { EditorMonitor } from './editor-monitor.js';

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
  | { type: 'git:branch'; branches: Record<string, GitStatus | null> }
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
  private gitMonitor: GitMonitor;
  private editorMonitor: EditorMonitor;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private onIdle?: () => void;

  constructor(server: Server, ptyManager: PtyManager, projectStore: ProjectStore, options?: WsHandlerOptions) {
    this.ptyManager = ptyManager;
    this.projectStore = projectStore;
    this.onIdle = options?.onIdle;
    this.portMonitor = new PortMonitor((ports) => {
      this.send({ type: 'port:status', ports });
    });
    this.claudeMonitor = new ClaudeMonitor(ptyManager, (statuses) => {
      this.send({ type: 'claude:status', statuses });
    });
    this.gitMonitor = new GitMonitor(projectStore, (branches) => {
      this.send({ type: 'git:branch', branches });
    });
    this.editorMonitor = new EditorMonitor((projectName) => {
      this.send({ type: 'editor:active', projectName });
    });

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

      // Resume all monitors when a client connects
      this.resumeMonitors();

      // Send cached state to newly connected client
      const branches = this.gitMonitor.getBranches();
      if (Object.keys(branches).length > 0) {
        this.send({ type: 'git:branch', branches });
      }
      const ports = this.portMonitor.getPortStatus();
      if (Object.keys(ports).length > 0) {
        this.send({ type: 'port:status', ports });
      }
      const statuses = this.claudeMonitor.getStatuses();
      if (Object.keys(statuses).length > 0) {
        this.send({ type: 'claude:status', statuses });
      }
      const editorState = this.editorMonitor.getState();
      if (editorState.projectName) {
        this.send({ type: 'editor:active', projectName: editorState.projectName });
      }

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
        this.pauseMonitors();
        this.startIdleTimer();
      });

      ws.on('error', (err) => {
        console.error('WebSocket error:', err.message);
        this.client = null;
        this.pauseMonitors();
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
        this.claudeMonitor.removeTerminal(msg.terminalId);
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

  getEditorState(): { projectName: string | null; needsAccessibility?: boolean } {
    return this.editorMonitor.getState();
  }

  private resumeMonitors(): void {
    this.portMonitor.resume();
    this.claudeMonitor.resume();
    this.gitMonitor.resume();
    this.editorMonitor.resume();
  }

  private pauseMonitors(): void {
    this.portMonitor.pause();
    this.claudeMonitor.pause();
    this.gitMonitor.pause();
    this.editorMonitor.pause();
  }

  destroy(): void {
    this.portMonitor.destroy();
    this.claudeMonitor.destroy();
    this.gitMonitor.destroy();
    this.editorMonitor.destroy();
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
          this.claudeMonitor.recordOutput(tid);
        },
        (tid, exitCode) => {
          this.portMonitor.removeTerminal(tid);
          this.claudeMonitor.removeTerminal(tid);
          this.send({ type: 'pty:exit', terminalId: tid, exitCode });
        },
      );
      this.projectStore.addTerminal(projectId, terminalId);
    } catch (e) {
      this.send({ type: 'error', message: `Failed to spawn terminal: ${e}` });
    }
  }
}
