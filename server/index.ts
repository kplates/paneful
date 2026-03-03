#!/usr/bin/env node

import { program } from 'commander';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { sendIpcCommand } from './ipc-client.js';
import { openBrowser, focusBrowser } from './browser.js';

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

function isNewerVersion(latest: string, current: string): boolean {
  const l = latest.split('.').map(Number);
  const c = current.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((l[i] || 0) > (c[i] || 0)) return true;
    if ((l[i] || 0) < (c[i] || 0)) return false;
  }
  return false;
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

async function startServer(devMode: boolean, port: number): Promise<void> {
  // Lazy-load heavy dependencies (express, node-pty, ws, etc.)
  // so CLI commands that don't need the server start instantly
  const [
    { default: http },
    { default: express },
    { execFile },
    { v4: uuidv4 },
    { PtyManager },
    { ProjectStore },
    { WsHandler },
    { startIpcListener },
    { SettingsStore },
  ] = await Promise.all([
    import('node:http'),
    import('express'),
    import('node:child_process'),
    import('uuid'),
    import('./pty-manager.js'),
    import('./project-store.js'),
    import('./ws-handler.js'),
    import('./ipc.js'),
    import('./settings-store.js'),
  ]);

  const app = express();
  app.use(express.json());

  const ptyManager = new PtyManager();
  const projectStore = new ProjectStore(dataDir());
  const settingsStore = new SettingsStore(dataDir());

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

  app.get('/api/settings', (_req, res) => {
    res.json(settingsStore.get());
  });

  app.put('/api/settings', (req, res) => {
    res.json(settingsStore.update(req.body));
  });

  app.post('/api/projects/:id/kill', (req, res) => {
    const killed = ptyManager.killProject(req.params.id);
    res.json({ killed: killed.length });
  });

  function getStaleProjects(): { id: string; name: string; cwd: string }[] {
    const stale: { id: string; name: string; cwd: string }[] = [];
    for (const project of projectStore.list()) {
      try {
        const stat = fs.statSync(project.cwd);
        if (!stat.isDirectory()) throw new Error('not a directory');
      } catch {
        stale.push({ id: project.id, name: project.name, cwd: project.cwd });
      }
    }
    return stale;
  }

  app.get('/api/cleanup-projects', (_req, res) => {
    res.json({ stale: getStaleProjects() });
  });

  app.post('/api/cleanup-projects', (_req, res) => {
    const stale = getStaleProjects();
    for (const project of stale) {
      ptyManager.killProject(project.id);
      projectStore.remove(project.id);
    }
    res.json({ removed: stale.map((p) => p.name) });
  });

  app.post('/api/validate-path', (req, res) => {
    const { path: rawPath } = req.body;
    if (!rawPath) { res.json({ valid: false }); return; }
    const resolved = rawPath.replace(/^~/, os.homedir());
    try {
      const stat = fs.statSync(resolved);
      res.json({ valid: stat.isDirectory(), resolved });
    } catch {
      res.json({ valid: false });
    }
  });

  // Active editor detection — single AppleScript gets frontmost app + window title
  const editorPatterns = ['cursor', 'code', 'vscode', 'visual studio code', 'zed', 'windsurf', 'electron'];
  let editorCache: { projectName: string | null; needsAccessibility?: boolean } = { projectName: null };

  const editorScript = `
    tell application "System Events"
      set frontApp to name of first application process whose frontmost is true
      set winTitle to ""
      tell process frontApp
        if exists front window then
          set winTitle to name of front window
        end if
      end tell
      return frontApp & linefeed & winTitle
    end tell
  `;

  function pollActiveEditor() {
    if (process.platform !== 'darwin') return;

    execFile('osascript', ['-e', editorScript], { timeout: 2000 }, (err, stdout, stderr) => {
      if (err) {
        const needsAccess = stderr?.includes('not allowed assistive access') || stderr?.includes('1719');
        editorCache = { projectName: null, needsAccessibility: needsAccess || undefined };
        return;
      }

      const lines = stdout.trim().split('\n');
      const appName = (lines[0] || '').trim();
      const title = (lines[1] || '').trim();

      const isEditor = editorPatterns.some((pat) => appName.toLowerCase().includes(pat));
      if (!isEditor || !title) {
        editorCache = { projectName: null };
        return;
      }

      let projectName: string | null = null;

      // Try to extract a path from the title (e.g. "~/Documents/source/foo - branch")
      const pathMatch = title.match(/^(~?\/[^\s]+)/);
      if (pathMatch) {
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
        } else {
          projectName = title;
        }
      }

      const prev = editorCache.projectName;
      editorCache = { projectName };
      if (projectName && projectName !== prev) {
        wsHandler.send({ type: 'editor:active', projectName });
      }
    });
  }

  // Poll every 500ms — single osascript call is fast
  pollActiveEditor();
  setInterval(pollActiveEditor, 500);

  app.get('/api/active-editor', (_req, res) => {
    res.json(editorCache);
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
  const wsHandler = new WsHandler(server, ptyManager, projectStore, { onIdle: () => shutdown() });

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

    if (!devMode && !process.env.PANEFUL_APP) {
      openBrowser(actualPort);
    }
  });

  // Graceful shutdown
  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log('Shutting down...');
    wsHandler.destroy();
    ptyManager.killAll();
    removeLockfile();
    ipcServer.close();
    server.close(() => {
      process.exit(0);
    });
    // Force exit if server.close() hangs
    setTimeout(() => process.exit(0), 2000);
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
  .option('--install-app', 'Create Paneful.app (macOS only)')
  .option('--app-path <path>', 'Custom path for Paneful.app (default: /Applications/Paneful.app)')
  .option('--dev', 'Run in development mode (proxy to Vite dev server)')
  .option('--port <number>', 'Port to listen on (default: random)', parseInt);

program
  .command('update')
  .description('Update paneful to the latest version')
  .action(async () => {
    const { execSync } = await import('node:child_process');

    const latest = await getLatestVersion();
    if (!latest) {
      console.log('Could not check for updates. Try: npm install -g paneful@latest');
      process.exit(1);
    }
    if (!isNewerVersion(latest, CURRENT_VERSION)) {
      console.log(`Already on latest version (v${CURRENT_VERSION})`);
      return;
    }

    console.log(`Updating paneful v${CURRENT_VERSION} → v${latest}...`);
    execSync('npm install -g paneful@latest', { stdio: 'inherit' });

    // Find existing Paneful.app to rebuild it in place
    let appPath: string | null = null;
    if (process.platform === 'darwin') {
      try {
        const found = execSync("mdfind \"kMDItemCFBundleIdentifier == 'com.paneful.app'\"", { encoding: 'utf-8' }).trim();
        if (found) appPath = found.split('\n')[0];
      } catch { /* spotlight unavailable */ }
      // Fallback: check common locations
      if (!appPath) {
        for (const p of [
          path.join(os.homedir(), 'Applications', 'Paneful.app'),
          '/Applications/Paneful.app',
        ]) {
          if (fs.existsSync(p)) { appPath = p; break; }
        }
      }
    }
    if (appPath) {
      console.log(`\nRebuilding ${appPath}...`);
      const { installApp } = await import('./install-app.js');
      await installApp(appPath);
    }

    console.log('\nUpdate complete!');
  });

program.action(async (opts) => {
    if (opts.installApp) {
      const { installApp } = await import('./install-app.js');
      await installApp(opts.appPath);
      return;
    }

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
      if (!focusBrowser(lock.port)) {
        openBrowser(lock.port);
      }
      return;
    }
    if (lock) {
      removeLockfile();
    }

    await startServer(opts.dev || false, opts.port || 0);
  });

program.parse();
