import { WebSocket, WebSocketServer } from 'ws';
import type { Server } from 'node:http';
import { v4 as uuidv4 } from 'uuid';
import { PtyManager } from './pty-manager.js';
import { ProjectStore, newProject } from './project-store.js';
import { PortMonitor } from './port-monitor.js';
import { ClaudeMonitor } from './claude-monitor.js';
import { GitMonitor, type GitStatus } from './git-monitor.js';
import {
  GitSourceControl,
  type SourceControlStatus,
  type DiffKind,
  type ActionKind,
} from './git-source-control.js';
import { EditorMonitor } from './editor-monitor.js';
import { InboxMonitor } from './inbox-monitor.js';

// Client → Server
type ClientMessage =
  | { type: 'pty:spawn'; terminalId: string; projectId: string; cwd: string }
  | { type: 'pty:input'; terminalId: string; data: string }
  | { type: 'pty:resize'; terminalId: string; cols: number; rows: number }
  | { type: 'pty:kill'; terminalId: string }
  | { type: 'project:kill'; projectId: string }
  | { type: 'project:create'; projectId: string; name: string; cwd: string }
  | { type: 'project:remove'; projectId: string }
  | { type: 'open:url'; url: string }
  | { type: 'open:file'; projectId: string; path: string }
  | { type: 'editor:sync'; enabled: boolean }
  | { type: 'sc:set-active'; projectId: string | null }
  | { type: 'sc:diff:request'; projectId: string; file: string; kind: DiffKind }
  | { type: 'sc:stage'; projectId: string; files: string[] }
  | { type: 'sc:unstage'; projectId: string; files: string[] }
  | { type: 'sc:discard'; projectId: string; trackedFiles: string[]; untrackedFiles: string[] }
  | { type: 'sc:commit'; projectId: string; message: string }
  | { type: 'sc:push'; projectId: string }
  | { type: 'sc:pull'; projectId: string }
  | { type: 'sc:stash:create'; projectId: string; message: string }
  | { type: 'sc:stash:pop'; projectId: string; index: number }
  | { type: 'sc:stash:apply'; projectId: string; index: number }
  | { type: 'sc:stash:drop'; projectId: string; index: number };

// Server → Client
type ServerMessage =
  | { type: 'pty:output'; terminalId: string; data: string }
  | { type: 'pty:exit'; terminalId: string; exitCode: number }
  | { type: 'project:spawned'; projectId: string; name: string; cwd: string }
  | { type: 'editor:active'; projectName: string }
  | { type: 'editor:status'; needsAccessibility: boolean }
  | { type: 'port:status'; ports: Record<string, number[]> }
  | { type: 'claude:status'; statuses: Record<string, 'active' | 'idle'> }
  | { type: 'git:branch'; branches: Record<string, GitStatus | null> }
  | { type: 'inbox:paste'; files: string[] }
  | { type: 'sc:status'; projectId: string; status: SourceControlStatus | null }
  | {
      type: 'sc:diff';
      projectId: string;
      file: string;
      kind: DiffKind;
      diff: string;
      binary: boolean;
      truncated: boolean;
    }
  | {
      type: 'sc:action:result';
      projectId: string;
      action: ActionKind;
      ok: boolean;
      error?: string;
    }
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
  private sourceControl: GitSourceControl;
  private editorMonitor: EditorMonitor;
  private inboxMonitor: InboxMonitor;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private onIdle?: () => void;

  constructor(server: Server, ptyManager: PtyManager, projectStore: ProjectStore, dataDir: string, options?: WsHandlerOptions) {
    this.ptyManager = ptyManager;
    this.projectStore = projectStore;
    this.onIdle = options?.onIdle;
    this.portMonitor = new PortMonitor(ptyManager, (ports) => {
      this.send({ type: 'port:status', ports });
    });
    this.claudeMonitor = new ClaudeMonitor(ptyManager, (statuses) => {
      this.send({ type: 'claude:status', statuses });
    });
    this.gitMonitor = new GitMonitor(projectStore, (branches) => {
      this.send({ type: 'git:branch', branches });
    });
    this.sourceControl = new GitSourceControl(projectStore, (projectId, status) => {
      this.send({ type: 'sc:status', projectId, status });
    });
    this.editorMonitor = new EditorMonitor(
      (projectName) => {
        this.send({ type: 'editor:active', projectName });
      },
      (needsAccessibility) => {
        this.send({ type: 'editor:status', needsAccessibility });
      },
    );
    this.inboxMonitor = new InboxMonitor(dataDir, {
      onPaste: (files) => {
        this.send({ type: 'inbox:paste', files });
      },
      onSpawn: (cwd, name) => {
        const existing = this.projectStore.findByCwd(cwd);
        const id = existing?.id ?? uuidv4();
        if (!existing) {
          this.projectStore.create(newProject(id, name, cwd));
        }
        this.send({ type: 'project:spawned', projectId: id, name, cwd });
      },
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
        this.claudeMonitor.removeTerminal(msg.terminalId);
        const projectId = this.ptyManager.kill(msg.terminalId);
        if (projectId) {
          this.projectStore.removeTerminal(projectId, msg.terminalId);
          this.send({ type: 'pty:exit', terminalId: msg.terminalId, exitCode: 0 });
        }
        break;
      }

      case 'project:kill': {
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
        const killed = this.ptyManager.killProject(msg.projectId);
        for (const tid of killed) {
          this.send({ type: 'pty:exit', terminalId: tid, exitCode: 0 });
        }
        this.projectStore.remove(msg.projectId);
        break;
      }

      case 'open:url': {
        const url = msg.url;
        if (/^https?:\/\//i.test(url)) {
          import('open').then(({ default: open }) => {
            open(url).catch(() => {});
          });
        }
        break;
      }

      case 'open:file': {
        const project = this.projectStore.list().find((p) => p.id === msg.projectId);
        if (!project) break;
        // Resolve and guard against path traversal
        import('node:path').then((path) => {
          const abs = path.resolve(project.cwd, msg.path);
          const projectRoot = path.resolve(project.cwd);
          if (abs !== projectRoot && !abs.startsWith(projectRoot + path.sep)) return;
          import('open').then(({ default: open }) => {
            open(abs).catch(() => {});
          });
        });
        break;
      }

      case 'editor:sync': {
        if (msg.enabled) {
          this.editorMonitor.resume();
          // Send cached state
          const editorState = this.editorMonitor.getState();
          if (editorState.projectName) {
            this.send({ type: 'editor:active', projectName: editorState.projectName });
          }
          if (editorState.needsAccessibility) {
            this.send({ type: 'editor:status', needsAccessibility: true });
          }
        } else {
          this.editorMonitor.pause();
          this.send({ type: 'editor:status', needsAccessibility: false });
        }
        break;
      }

      case 'sc:set-active': {
        this.sourceControl.setActive(msg.projectId);
        break;
      }

      case 'sc:diff:request': {
        const { projectId, file, kind } = msg;
        this.sourceControl.requestDiff(projectId, file, kind).then((result) => {
          if (!result) return;
          this.send({
            type: 'sc:diff',
            projectId,
            file,
            kind,
            diff: result.diff,
            binary: result.binary,
            truncated: result.truncated,
          });
        });
        break;
      }

      case 'sc:stage': {
        const { projectId, files } = msg;
        this.sourceControl.stage(projectId, files).then((res) => {
          this.send({ type: 'sc:action:result', projectId, action: 'stage', ok: res.ok, error: res.error });
        });
        break;
      }

      case 'sc:unstage': {
        const { projectId, files } = msg;
        this.sourceControl.unstage(projectId, files).then((res) => {
          this.send({ type: 'sc:action:result', projectId, action: 'unstage', ok: res.ok, error: res.error });
        });
        break;
      }

      case 'sc:discard': {
        const { projectId, trackedFiles, untrackedFiles } = msg;
        this.sourceControl.discard(projectId, trackedFiles, untrackedFiles).then((res) => {
          this.send({ type: 'sc:action:result', projectId, action: 'discard', ok: res.ok, error: res.error });
        });
        break;
      }

      case 'sc:commit': {
        const { projectId, message } = msg;
        this.sourceControl.commit(projectId, message).then((res) => {
          this.send({ type: 'sc:action:result', projectId, action: 'commit', ok: res.ok, error: res.error });
        });
        break;
      }

      case 'sc:push': {
        const { projectId } = msg;
        this.sourceControl.push(projectId).then((res) => {
          this.send({ type: 'sc:action:result', projectId, action: 'push', ok: res.ok, error: res.error });
        });
        break;
      }

      case 'sc:pull': {
        const { projectId } = msg;
        this.sourceControl.pull(projectId).then((res) => {
          this.send({ type: 'sc:action:result', projectId, action: 'pull', ok: res.ok, error: res.error });
        });
        break;
      }

      case 'sc:stash:create': {
        const { projectId, message } = msg;
        this.sourceControl.stashCreate(projectId, message).then((res) => {
          this.send({ type: 'sc:action:result', projectId, action: 'stash:create', ok: res.ok, error: res.error });
        });
        break;
      }

      case 'sc:stash:pop': {
        const { projectId, index } = msg;
        this.sourceControl.stashPop(projectId, index).then((res) => {
          this.send({ type: 'sc:action:result', projectId, action: 'stash:pop', ok: res.ok, error: res.error });
        });
        break;
      }

      case 'sc:stash:apply': {
        const { projectId, index } = msg;
        this.sourceControl.stashApply(projectId, index).then((res) => {
          this.send({ type: 'sc:action:result', projectId, action: 'stash:apply', ok: res.ok, error: res.error });
        });
        break;
      }

      case 'sc:stash:drop': {
        const { projectId, index } = msg;
        this.sourceControl.stashDrop(projectId, index).then((res) => {
          this.send({ type: 'sc:action:result', projectId, action: 'stash:drop', ok: res.ok, error: res.error });
        });
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
    this.sourceControl.resume();
    // Editor monitor is started on-demand via editor:sync message
    this.inboxMonitor.resume();
  }

  private pauseMonitors(): void {
    this.portMonitor.pause();
    this.claudeMonitor.pause();
    this.gitMonitor.pause();
    this.sourceControl.pause();
    this.editorMonitor.pause();
    this.inboxMonitor.pause();
  }

  destroy(): void {
    this.portMonitor.destroy();
    this.claudeMonitor.destroy();
    this.gitMonitor.destroy();
    this.sourceControl.destroy();
    this.editorMonitor.destroy();
    this.inboxMonitor.destroy();
  }

  private handlePtySpawn(terminalId: string, projectId: string, cwd: string): void {
    try {
      this.ptyManager.spawn(
        terminalId,
        projectId,
        cwd,
        (tid, data) => {
          this.send({ type: 'pty:output', terminalId: tid, data });
          this.claudeMonitor.recordOutput(tid);
        },
        (tid, exitCode) => {
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
