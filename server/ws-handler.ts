import { WebSocket, WebSocketServer } from 'ws';
import type { Server } from 'node:http';
import { v4 as uuidv4 } from 'uuid';
import fs from 'node:fs';
import path from 'node:path';
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
import {
  ScheduleStore,
  type ScheduledJob,
  type ScheduledRun,
} from './schedule-store.js';
import { Scheduler } from './scheduler.js';

// Client → Server
type ClientMessage =
  | { type: 'pty:spawn'; terminalId: string; projectId: string; cwd: string; command?: string }
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
  | { type: 'sc:stash:drop'; projectId: string; index: number }
  | { type: 'schedule:list' }
  | { type: 'schedule:runs:list'; jobId?: string }
  | {
      type: 'schedule:create';
      job: { name: string; cron: string; command: string; cwd: string; enabled: boolean };
    }
  | { type: 'schedule:run:log:request'; runId: string }
  | { type: 'schedule:update'; job: ScheduledJob }
  | { type: 'schedule:delete'; jobId: string }
  | { type: 'schedule:toggle'; jobId: string; enabled: boolean }
  | { type: 'schedule:run-now'; jobId: string }
  | { type: 'schedule:run:pause'; runId: string }
  | { type: 'schedule:run:resume'; runId: string }
  | { type: 'schedule:run:remove'; runId: string }
  | { type: 'schedule:run:kill'; runId: string }
  | { type: 'schedule:run:attach'; runId: string }
  | { type: 'schedule:run:detach'; runId: string }
  | { type: 'schedule:run:input'; runId: string; data: string }
  | { type: 'schedule:run:resize'; runId: string; cols: number; rows: number };

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
  | { type: 'schedule:jobs'; jobs: ScheduledJob[] }
  | { type: 'schedule:runs'; runs: ScheduledRun[] }
  | { type: 'schedule:run:update'; run: ScheduledRun }
  | {
      type: 'schedule:fire';
      jobId: string;
      jobName: string;
      runId: string;
    }
  | { type: 'schedule:run:log'; runId: string; log: string }
  | { type: 'schedule:run:output'; runId: string; data: string }
  | { type: 'error'; message: string };

export interface WsHandlerOptions {
  onIdle?: () => void;
}

/** Sentinel projectId for server-owned scheduled PTYs (never appears as a client-visible project). */
const SCHEDULES_PROJECT_SENTINEL = '__schedules__';

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
  private scheduleStore: ScheduleStore;
  private scheduler: Scheduler;
  /** Maps a spawned terminalId back to its scheduled-run id so the exit hook can finalize the run. */
  private scheduledTerminals = new Map<string, string>();
  /** Per-run log capture state — file path + bytes written so far (capped). */
  private runLogState = new Map<string, { filePath: string; bytes: number }>();
  private runLogsDir = '';
  /** runIds the current client is actively viewing — server streams output for these. */
  private attachedRuns = new Set<string>();
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
    this.scheduleStore = new ScheduleStore(dataDir, (id) => projectStore.get(id)?.cwd);
    this.scheduler = new Scheduler(this.scheduleStore, (job) => this.fireJob(job));
    // Scheduler runs as long as the server is alive — independent of WS client
    this.scheduler.start();
    this.runLogsDir = path.join(dataDir, 'runs');
    try { fs.mkdirSync(this.runLogsDir, { recursive: true }); } catch {}
    // Reconcile: any run that was active when the server last shut down is now stale.
    const now = Date.now();
    for (const run of this.scheduleStore.listRuns()) {
      if (run.finishedAt === null) {
        this.scheduleStore.updateRun(run.id, { finishedAt: now, exitCode: -1 });
      }
    }

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
      this.send({ type: 'schedule:jobs', jobs: this.scheduleStore.listJobs() });
      this.send({ type: 'schedule:runs', runs: this.scheduleStore.listRuns() });
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
        this.attachedRuns.clear();
        this.pauseMonitors();
        this.startIdleTimer();
      });

      ws.on('error', (err) => {
        console.error('WebSocket error:', err.message);
        this.client = null;
        this.attachedRuns.clear();
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
      if (this.client && this.client.readyState === WebSocket.OPEN) return;
      // Keep the server alive while any enabled scheduled job exists, so it can fire.
      if (this.scheduleStore.hasEnabledJobs()) {
        // Re-arm so we keep checking periodically (idle timer is the only ticker without WS)
        this.startIdleTimer();
        return;
      }
      console.log('No clients connected for 5 seconds, shutting down...');
      this.onIdle!();
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
        this.handlePtySpawn(msg.terminalId, msg.projectId, msg.cwd, msg.command);
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

      case 'schedule:list':
        this.send({ type: 'schedule:jobs', jobs: this.scheduleStore.listJobs() });
        break;

      case 'schedule:runs:list':
        this.send({ type: 'schedule:runs', runs: this.scheduleStore.listRuns(msg.jobId) });
        break;

      case 'schedule:create': {
        const job: ScheduledJob = {
          id: uuidv4(),
          name: msg.job.name,
          cron: msg.job.cron,
          command: msg.job.command,
          cwd: msg.job.cwd,
          enabled: msg.job.enabled,
          createdAt: Date.now(),
        };
        this.scheduleStore.createJob(job);
        this.send({ type: 'schedule:jobs', jobs: this.scheduleStore.listJobs() });
        break;
      }

      case 'schedule:run:log:request': {
        const log = this.readRunLog(msg.runId);
        this.send({ type: 'schedule:run:log', runId: msg.runId, log });
        break;
      }

      case 'schedule:update':
        this.scheduleStore.updateJob(msg.job);
        this.send({ type: 'schedule:jobs', jobs: this.scheduleStore.listJobs() });
        break;

      case 'schedule:delete': {
        const { jobId } = msg;
        // Stop any currently-running PTYs for this job's active runs,
        // and delete every run's captured log file.
        for (const run of this.scheduleStore.listRuns(jobId)) {
          this.removeRunLog(run.id);
          this.attachedRuns.delete(run.id);
          if (run.finishedAt === null && run.terminalId) {
            this.ptyManager.kill(run.terminalId);
            this.scheduledTerminals.delete(run.terminalId);
          }
        }
        this.scheduleStore.deleteJob(jobId);
        this.send({ type: 'schedule:jobs', jobs: this.scheduleStore.listJobs() });
        this.send({ type: 'schedule:runs', runs: this.scheduleStore.listRuns() });
        break;
      }

      case 'schedule:toggle': {
        const job = this.scheduleStore.getJob(msg.jobId);
        if (job) {
          this.scheduleStore.updateJob({ ...job, enabled: msg.enabled });
          this.send({ type: 'schedule:jobs', jobs: this.scheduleStore.listJobs() });
        }
        break;
      }

      case 'schedule:run-now': {
        const job = this.scheduleStore.getJob(msg.jobId);
        if (job) this.fireJob(job);
        break;
      }

      case 'schedule:run:pause': {
        const run = this.scheduleStore.listRuns().find((r) => r.id === msg.runId);
        if (run && run.finishedAt === null && run.terminalId) {
          if (this.ptyManager.pause(run.terminalId)) {
            const updated = this.scheduleStore.updateRun(msg.runId, { paused: true });
            if (updated) this.send({ type: 'schedule:run:update', run: updated });
          }
        }
        break;
      }

      case 'schedule:run:resume': {
        // Resume the SAME run via SIGCONT — process picks up exactly where it was.
        const run = this.scheduleStore.listRuns().find((r) => r.id === msg.runId);
        if (run && run.finishedAt === null && run.terminalId) {
          if (this.ptyManager.cont(run.terminalId)) {
            const updated = this.scheduleStore.updateRun(msg.runId, { paused: false });
            if (updated) this.send({ type: 'schedule:run:update', run: updated });
          }
        }
        break;
      }

      case 'schedule:run:remove':
        this.removeRunLog(msg.runId);
        this.scheduleStore.removeRun(msg.runId);
        this.send({ type: 'schedule:runs', runs: this.scheduleStore.listRuns() });
        break;

      case 'schedule:run:kill': {
        const { runId } = msg;
        const run = this.scheduleStore.listRuns().find((r) => r.id === runId);
        if (run && run.finishedAt === null && run.terminalId) {
          // Detach our tracking BEFORE killing — prevents the natural onExit
          // callback in fireJob from racing with our explicit update.
          this.scheduledTerminals.delete(run.terminalId);
          this.attachedRuns.delete(runId);
          this.runLogState.delete(runId);
          this.ptyManager.kill(run.terminalId);
          const updated = this.scheduleStore.updateRun(runId, {
            finishedAt: Date.now(),
            exitCode: -1,
          });
          if (updated) this.send({ type: 'schedule:run:update', run: updated });
        }
        break;
      }

      case 'schedule:run:attach': {
        const { runId } = msg;
        this.attachedRuns.add(runId);
        // Send the captured log so the viewer can populate with everything so far.
        this.send({ type: 'schedule:run:log', runId, log: this.readRunLog(runId) });
        break;
      }

      case 'schedule:run:detach':
        this.attachedRuns.delete(msg.runId);
        break;

      case 'schedule:run:input':
        // terminalId === runId for scheduled PTYs; write() no-ops if PTY is gone.
        this.ptyManager.write(msg.runId, msg.data);
        break;

      case 'schedule:run:resize':
        this.ptyManager.resize(msg.runId, msg.cols, msg.rows);
        break;
    }
  }

  private fireJob(job: ScheduledJob): void {
    const runId = uuidv4();
    // Run id doubles as the PTY's terminalId — schedule PTYs are server-owned,
    // never appear in any project's layout, and are addressed by runId everywhere.
    const terminalId = runId;
    const run: ScheduledRun = {
      id: runId,
      jobId: job.id,
      startedAt: Date.now(),
      finishedAt: null,
      exitCode: null,
      terminalId,
    };
    this.scheduleStore.addRun(run);
    this.scheduledTerminals.set(terminalId, runId);
    const logPath = path.join(this.runLogsDir, `${runId}.log`);
    this.runLogState.set(runId, { filePath: logPath, bytes: 0 });
    try { fs.writeFileSync(logPath, ''); } catch {}

    // Pre-flight: cwd must exist and be a directory. Without this, node-pty
    // throws an opaque ENOENT and we'd record an unexplained failure.
    try {
      const stat = fs.statSync(job.cwd);
      if (!stat.isDirectory()) throw new Error('not a directory');
    } catch (e) {
      const err = (e as { code?: string; message?: string }).code === 'ENOENT'
        ? `directory does not exist: ${job.cwd}`
        : `invalid working directory ${job.cwd}: ${(e as Error).message}`;
      try { fs.appendFileSync(logPath, `\r\n\x1b[31m[paneful: ${err}]\x1b[0m\r\n`); } catch {}
      const failed = this.scheduleStore.updateRun(runId, {
        finishedAt: Date.now(),
        exitCode: -1,
      });
      this.scheduledTerminals.delete(terminalId);
      this.runLogState.delete(runId);
      if (failed) this.send({ type: 'schedule:run:update', run: failed });
      this.send({ type: 'schedule:fire', jobId: job.id, jobName: job.name, runId });
      this.send({ type: 'schedule:run:update', run });
      return;
    }

    try {
      this.ptyManager.spawn(
        terminalId,
        SCHEDULES_PROJECT_SENTINEL,
        job.cwd,
        (tid, data) => {
          this.appendRunLog(runId, data);
          if (this.attachedRuns.has(runId)) {
            this.send({ type: 'schedule:run:output', runId, data });
          }
        },
        (_tid, exitCode) => {
          this.scheduledTerminals.delete(terminalId);
          this.runLogState.delete(runId);
          this.attachedRuns.delete(runId);
          const updated = this.scheduleStore.updateRun(runId, {
            finishedAt: Date.now(),
            exitCode,
          });
          if (updated) this.send({ type: 'schedule:run:update', run: updated });
        },
        job.command,
      );
    } catch (e) {
      // Spawn failed (e.g. cwd missing). Mark the run as finished immediately.
      const failed = this.scheduleStore.updateRun(runId, {
        finishedAt: Date.now(),
        exitCode: -1,
      });
      try {
        fs.appendFileSync(logPath, `\r\n[paneful] failed to spawn: ${(e as Error).message}\r\n`);
      } catch {}
      if (failed) this.send({ type: 'schedule:run:update', run: failed });
    }

    this.send({ type: 'schedule:fire', jobId: job.id, jobName: job.name, runId });
    this.send({ type: 'schedule:run:update', run });
  }

  private appendRunLog(runId: string, chunk: string): void {
    const state = this.runLogState.get(runId);
    if (!state) return;
    // Cap log size at 1MB per run; beyond that, silently drop further output.
    const remaining = 1_000_000 - state.bytes;
    if (remaining <= 0) return;
    const bytes = Buffer.byteLength(chunk, 'utf8');
    const data = bytes <= remaining ? chunk : chunk.slice(0, remaining);
    try {
      fs.appendFileSync(state.filePath, data);
      state.bytes += Buffer.byteLength(data, 'utf8');
    } catch {
      // Disk full or permission — give up silently
    }
  }

  private readRunLog(runId: string): string {
    const logPath = path.join(this.runLogsDir, `${runId}.log`);
    try {
      return fs.readFileSync(logPath, 'utf8');
    } catch {
      return '';
    }
  }

  private removeRunLog(runId: string): void {
    const logPath = path.join(this.runLogsDir, `${runId}.log`);
    try { fs.unlinkSync(logPath); } catch {}
    this.runLogState.delete(runId);
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
    this.scheduler.destroy();
  }

  private handlePtySpawn(terminalId: string, projectId: string, cwd: string, command?: string): void {
    try {
      this.ptyManager.spawn(
        terminalId,
        projectId,
        cwd,
        (tid, data) => {
          this.send({ type: 'pty:output', terminalId: tid, data });
          this.claudeMonitor.recordOutput(tid);
          const runId = this.scheduledTerminals.get(tid);
          if (runId) this.appendRunLog(runId, data);
        },
        (tid, exitCode) => {
          this.claudeMonitor.removeTerminal(tid);
          const runId = this.scheduledTerminals.get(tid);
          if (runId) {
            this.scheduledTerminals.delete(tid);
            this.runLogState.delete(runId);
            const updated = this.scheduleStore.updateRun(runId, {
              finishedAt: Date.now(),
              exitCode,
            });
            if (updated) this.send({ type: 'schedule:run:update', run: updated });
          }
          this.send({ type: 'pty:exit', terminalId: tid, exitCode });
        },
        command,
      );
      this.projectStore.addTerminal(projectId, terminalId);
    } catch (e) {
      this.send({ type: 'error', message: `Failed to spawn terminal: ${e}` });
    }
  }
}
