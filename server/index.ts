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

  app.post('/api/projects/:id/kill', (req, res) => {
    const killed = ptyManager.killProject(req.params.id);
    res.json({ killed: killed.length });
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

    if (process.platform === 'darwin') {
      execFile('mdfind', [`kMDItemFSName == '${name.replace(/'/g, "\\'")}'`], (err, stdout) => {
        if (err) { res.json({ path: null }); return; }
        const candidates = stdout.trim().split('\n').filter(Boolean);
        res.json({ path: findBest(candidates) });
      });
    } else {
      execFile('locate', ['-l', '20', '-b', `\\${name}`], (err, stdout) => {
        if (err) { res.json({ path: null }); return; }
        const candidates = stdout.trim().split('\n').filter(Boolean);
        res.json({ path: findBest(candidates) });
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

    startServer(opts.dev || false, opts.port || 0);
  });

program.parse();
