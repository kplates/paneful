#!/usr/bin/env node

import { program } from 'commander';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import express from 'express';
import { execFile } from 'node:child_process';
import { v4 as uuidv4 } from 'uuid';
import { PtyManager } from './pty-manager.js';
import { ProjectStore } from './project-store.js';
import { WsHandler } from './ws-handler.js';
import { startIpcListener, sendIpcCommand } from './ipc.js';
import { openBrowser } from './browser.js';

// ── Version check ──

const PKG_NAME = 'paneful';

function findPackageJson(): string | null {
  let dir = import.meta.dirname;
  for (let i = 0; i < 5; i++) {
    const p = path.join(dir, 'package.json');
    if (fs.existsSync(p)) return p;
    dir = path.dirname(dir);
  }
  return null;
}

const pkgPath = findPackageJson();
const CURRENT_VERSION = pkgPath ? JSON.parse(fs.readFileSync(pkgPath, 'utf-8')).version : '0.0.0';

let cachedLatest: { version: string; checkedAt: number } | null = null;
const CACHE_TTL = 3_600_000; // 1 hour

async function getLatestVersion(): Promise<string | null> {
  if (cachedLatest && Date.now() - cachedLatest.checkedAt < CACHE_TTL) {
    return cachedLatest.version;
  }
  try {
    const res = await fetch(`https://registry.npmjs.org/${PKG_NAME}/latest`);
    if (!res.ok) return null;
    const data = await res.json();
    cachedLatest = { version: data.version, checkedAt: Date.now() };
    return data.version;
  } catch {
    return null;
  }
}

// ── Paths ──

function dataDir(): string {
  const dir = path.join(os.homedir(), '.paneful');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function lockfilePath(): string {
  return path.join(dataDir(), 'paneful.lock');
}

function socketPath(): string {
  return path.join(dataDir(), 'paneful.sock');
}

// ── Lockfile ──

interface LockInfo {
  pid: number;
  port: number;
}

function readLockfile(): LockInfo | null {
  const p = lockfilePath();
  if (!fs.existsSync(p)) return null;
  try {
    const content = fs.readFileSync(p, 'utf-8');
    const lines = content.trim().split('\n');
    if (lines.length < 2) return null;
    const pid = parseInt(lines[0], 10);
    const port = parseInt(lines[1], 10);
    if (isNaN(pid) || isNaN(port)) return null;
    return { pid, port };
  } catch {
    return null;
  }
}

function writeLockfile(pid: number, port: number): void {
  fs.writeFileSync(lockfilePath(), `${pid}\n${port}`);
}

function removeLockfile(): void {
  try { fs.unlinkSync(lockfilePath()); } catch { /* ok */ }
  try { fs.unlinkSync(socketPath()); } catch { /* ok */ }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// ── CLI handlers ──

async function handleSpawn(): Promise<void> {
  const cwd = process.cwd();
  const name = path.basename(cwd) || 'project';

  const lock = readLockfile();
  if (lock && isProcessAlive(lock.pid)) {
    try {
      const resp = await sendIpcCommand(socketPath(), { command: 'spawn', cwd, name });
      if (resp.status === 'ok') {
        console.log(`Project '${name}' spawned in paneful`);
      } else {
        console.error('Error:', (resp as { message: string }).message);
        process.exit(1);
      }
    } catch (e) {
      console.error('Failed to connect:', (e as Error).message);
      process.exit(1);
    }
  } else {
    console.error('Paneful is not running. Start it with: paneful');
    process.exit(1);
  }
}

async function handleList(): Promise<void> {
  const lock = readLockfile();
  if (lock && isProcessAlive(lock.pid)) {
    try {
      const resp = await sendIpcCommand(socketPath(), { command: 'list' });
      if (resp.status === 'ok') {
        const data = (resp as { data?: string }).data;
        if (data && data.length > 0) {
          console.log(data);
        } else {
          console.log('No projects');
        }
      } else {
        console.error('Error:', (resp as { message: string }).message);
        process.exit(1);
      }
    } catch (e) {
      console.error('Failed to connect:', (e as Error).message);
      process.exit(1);
    }
  } else {
    console.log('Paneful is not running');
  }
}

async function handleKill(name: string): Promise<void> {
  const lock = readLockfile();
  if (lock && isProcessAlive(lock.pid)) {
    try {
      const resp = await sendIpcCommand(socketPath(), { command: 'kill', name });
      if (resp.status === 'ok') {
        console.log(`Project '${name}' killed`);
      } else {
        console.error('Error:', (resp as { message: string }).message);
        process.exit(1);
      }
    } catch (e) {
      console.error('Failed to connect:', (e as Error).message);
      process.exit(1);
    }
  } else {
    console.error('Paneful is not running');
    process.exit(1);
  }
}

// ── Server ──

function startServer(devMode: boolean, port: number): void {
  const app = express();
  app.use(express.json());

  const ptyManager = new PtyManager();
  const projectStore = new ProjectStore(dataDir());

  // API routes
  app.get('/api/projects', (_req, res) => {
    res.json(projectStore.list());
  });

  app.post('/api/projects', (req, res) => {
    const { id, name = 'Unnamed', cwd = '/' } = req.body;
    const projectId = id || uuidv4();
    const project = { id: projectId, name, cwd, terminal_ids: [] as string[] };
    projectStore.create(project);
    res.status(201).json(project);
  });

  app.delete('/api/projects/:id', (req, res) => {
    ptyManager.killProject(req.params.id);
    projectStore.remove(req.params.id);
    res.status(204).end();
  });

  app.get('/api/version', async (_req, res) => {
    const latest = await getLatestVersion();
    res.json({ current: CURRENT_VERSION, latest });
  });

  app.post('/api/projects/:id/kill', (req, res) => {
    const killed = ptyManager.killProject(req.params.id);
    res.json({ killed: killed.length });
  });

  // Get the active editor's project folder name (for auto-focus on window switch)
  app.get('/api/active-editor', (_req, res) => {
    if (process.platform !== 'darwin') {
      res.json({ projectName: null });
      return;
    }

    // Step 1: Find editor processes dynamically — match known editor keywords
    const editorPatterns = ['cursor', 'code', 'vscode', 'visual studio code', 'zed', 'windsurf'];

    const findScript = `
      tell application "System Events"
        set procNames to name of every process whose background only is false
        set output to ""
        repeat with p in procNames
          set output to output & p & linefeed
        end repeat
        return output
      end tell
    `;

    execFile('osascript', ['-e', findScript], { timeout: 2000 }, (err, stdout, stderr) => {
      if (err) {
        const needsAccess = stderr?.includes('not allowed assistive access') || stderr?.includes('1719');
        res.json({ projectName: null, needsAccessibility: needsAccess || undefined });
        return;
      }

      const processes = stdout.trim().split('\n').map((p) => p.trim()).filter(Boolean);
      const editorProcess = processes.find((p) =>
        editorPatterns.some((pat) => p.toLowerCase().includes(pat))
      );

      if (!editorProcess) {
        res.json({ projectName: null });
        return;
      }

      // Step 2: Get the front window title of the matched editor
      const titleScript = `
        tell application "System Events"
          tell process "${editorProcess.replace(/"/g, '\\"')}"
            if exists front window then
              return name of front window
            end if
          end tell
        end tell
        return ""
      `;

      execFile('osascript', ['-e', titleScript], { timeout: 2000 }, (err2, stdout2) => {
        if (err2 || !stdout2.trim()) {
          res.json({ projectName: null });
          return;
        }

        const title = stdout2.trim();
        let projectName: string | null = null;

        // Try to extract a path from the title (e.g. "~/Documents/source/foo - branch")
        const pathMatch = title.match(/^(~?\/[^\s]+)/);
        if (pathMatch) {
          // Grab the deepest folder from the path
          const segments = pathMatch[1].replace(/\/$/, '').split('/');
          projectName = segments[segments.length - 1] || null;
        }

        // Fallback: default title format "file — project — Editor" or "project — Editor"
        if (!projectName) {
          const parts = title.split(' \u2014 ');
          if (parts.length >= 3) {
            projectName = parts[parts.length - 2];
          } else if (parts.length === 2) {
            projectName = parts[0];
          }
        }

        res.json({ projectName });
      });
    });
  });

  // Resolve a dropped file's full path using OS file index (Spotlight on macOS)
  app.post('/api/resolve-path', (req, res) => {
    const { name, size, lastModified } = req.body;
    if (!name) {
      res.status(400).json({ error: 'name required' });
      return;
    }

    const findBest = (candidates: string[]): string | null => {
      if (candidates.length === 0) return null;
      if (candidates.length === 1) return candidates[0];

      // Score candidates: exact size + mtime match wins, then size-only, then most recent
      let best: { path: string; score: number; mtime: number } | null = null;
      for (const candidate of candidates) {
        try {
          const stat = fs.statSync(candidate);
          let score = 0;
          if (size && stat.size === size) score += 10;
          if (lastModified && Math.abs(stat.mtimeMs - lastModified) < 2000) score += 5;
          // Exclude node_modules and hidden dirs to prefer "real" files
          if (!candidate.includes('node_modules') && !candidate.includes('/.')) score += 1;
          if (!best || score > best.score || (score === best.score && stat.mtimeMs > best.mtime)) {
            best = { path: candidate, score, mtime: stat.mtimeMs };
          }
        } catch { /* skip inaccessible */ }
      }
      return best?.path ?? candidates[0];
    };

    const respond = (resolved: string | null) => {
      if (!resolved) { res.json({ path: null }); return; }
      try {
        const isDirectory = fs.statSync(resolved).isDirectory();
        res.json({ path: resolved, isDirectory });
      } catch {
        res.json({ path: resolved, isDirectory: false });
      }
    };

    if (process.platform === 'darwin') {
      execFile('mdfind', [`kMDItemFSName == '${name.replace(/'/g, "\\'")}'`], (err, stdout) => {
        if (err) { respond(null); return; }
        const candidates = stdout.trim().split('\n').filter(Boolean);
        respond(findBest(candidates));
      });
    } else {
      execFile('locate', ['-l', '20', '-b', `\\${name}`], (err, stdout) => {
        if (err) { respond(null); return; }
        const candidates = stdout.trim().split('\n').filter(Boolean);
        respond(findBest(candidates));
      });
    }
  });

  // Serve static frontend (production only)
  if (!devMode) {
    // In production dist: dist/server/index.js -> dist/web/ is sibling
    const webDir = path.resolve(import.meta.dirname, '..', 'web');

    if (fs.existsSync(webDir)) {
      app.use(express.static(webDir));
      // SPA fallback
      app.get('*', (_req, res) => {
        res.sendFile(path.join(webDir, 'index.html'));
      });
    }
  }

  const server = http.createServer(app);

  // WebSocket handler
  const wsHandler = new WsHandler(server, ptyManager, projectStore);

  // IPC listener
  const ipcServer = startIpcListener(socketPath(), ptyManager, projectStore, wsHandler);

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Port ${port} is already in use. Paneful may already be running.`);
      console.error(`Use --port <number> to specify a different port.`);
      process.exit(1);
    }
    throw err;
  });

  server.listen(port, '127.0.0.1', () => {
    const addr = server.address();
    const actualPort = typeof addr === 'object' && addr ? addr.port : port;

    writeLockfile(process.pid, actualPort);
    console.log(`Paneful running on http://localhost:${actualPort}`);

    if (!devMode) {
      openBrowser(actualPort);
    }
  });

  // Graceful shutdown
  const shutdown = () => {
    console.log('Shutting down...');
    ptyManager.killAll();
    removeLockfile();
    ipcServer.close();
    server.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

// ── CLI ──

program
  .name('paneful')
  .description('Browser-based terminal multiplexer')
  .option('--spawn', 'Spawn a new project in the current directory')
  .option('--list', 'List all projects')
  .option('--kill <name>', 'Kill a project by name')
  .option('--dev', 'Run in development mode (proxy to Vite dev server)')
  .option('--port <number>', 'Port to listen on (default: random available)', parseInt)
  .action(async (opts) => {
    if (opts.list) {
      await handleList();
      return;
    }

    if (opts.kill) {
      await handleKill(opts.kill);
      return;
    }

    if (opts.spawn) {
      await handleSpawn();
      return;
    }

    // Default: start server (or open browser if already running)
    const lock = readLockfile();
    if (lock && isProcessAlive(lock.pid)) {
      console.log(`Paneful already running on port ${lock.port}`);
      openBrowser(lock.port);
      return;
    }
    if (lock) {
      removeLockfile();
    }

    startServer(opts.dev || false, opts.port || 56170);
  });

program.parse();
