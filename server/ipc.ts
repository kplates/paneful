import net from 'node:net';
import fs from 'node:fs';
import { v4 as uuidv4 } from 'uuid';
import { PtyManager } from './pty-manager.js';
import { ProjectStore, newProject } from './project-store.js';
import type { WsHandler } from './ws-handler.js';

interface IpcSpawnRequest {
  command: 'spawn';
  cwd: string;
  name: string;
}

interface IpcListRequest {
  command: 'list';
}

interface IpcKillRequest {
  command: 'kill';
  name: string;
}

type IpcRequest = IpcSpawnRequest | IpcListRequest | IpcKillRequest;

interface IpcOkResponse {
  status: 'ok';
  data?: string;
}

interface IpcErrorResponse {
  status: 'error';
  message: string;
}

type IpcResponse = IpcOkResponse | IpcErrorResponse;

export function startIpcListener(
  socketPath: string,
  ptyManager: PtyManager,
  projectStore: ProjectStore,
  wsHandler: WsHandler,
): net.Server {
  // Remove stale socket file
  try { fs.unlinkSync(socketPath); } catch { /* doesn't exist */ }

  const server = net.createServer((conn) => {
    let buffer = '';

    conn.on('data', (chunk) => {
      buffer += chunk.toString();
      const newlineIdx = buffer.indexOf('\n');
      if (newlineIdx === -1) return;

      const line = buffer.slice(0, newlineIdx).trim();
      buffer = buffer.slice(newlineIdx + 1);

      let request: IpcRequest;
      try {
        request = JSON.parse(line);
      } catch {
        const resp: IpcResponse = { status: 'error', message: 'Invalid request' };
        conn.write(JSON.stringify(resp) + '\n');
        conn.end();
        return;
      }

      const response = handleIpcRequest(request, ptyManager, projectStore, wsHandler);
      conn.write(JSON.stringify(response) + '\n');
      conn.end();
    });

    conn.on('error', () => { /* client disconnected */ });
  });

  server.listen(socketPath, () => {
    console.log(`IPC listener started at ${socketPath}`);
  });

  return server;
}

function handleIpcRequest(
  request: IpcRequest,
  ptyManager: PtyManager,
  projectStore: ProjectStore,
  wsHandler: WsHandler,
): IpcResponse {
  switch (request.command) {
    case 'spawn': {
      const id = uuidv4();
      const project = newProject(id, request.name, request.cwd);
      projectStore.create(project);

      // Notify the frontend
      wsHandler.send({
        type: 'project:spawned',
        projectId: id,
        name: request.name,
        cwd: request.cwd,
      });

      return { status: 'ok' };
    }

    case 'list': {
      const projects = projectStore.list();
      const lines = projects.map(
        (p) => `${p.name} (${p.cwd}) - ${p.terminal_ids.length} terminals`,
      );
      return { status: 'ok', data: lines.join('\n') };
    }

    case 'kill': {
      const project = projectStore.findByName(request.name);
      if (project) {
        ptyManager.killProject(project.id);
        projectStore.remove(project.id);
        return { status: 'ok' };
      }
      return { status: 'error', message: `Project '${request.name}' not found` };
    }
  }
}

export async function sendIpcCommand(socketPath: string, request: IpcRequest): Promise<IpcResponse> {
  return new Promise((resolve, reject) => {
    const client = net.createConnection(socketPath, () => {
      client.write(JSON.stringify(request) + '\n');
    });

    let buffer = '';
    client.on('data', (chunk) => {
      buffer += chunk.toString();
      const newlineIdx = buffer.indexOf('\n');
      if (newlineIdx !== -1) {
        const line = buffer.slice(0, newlineIdx).trim();
        try {
          resolve(JSON.parse(line));
        } catch {
          reject(new Error('Invalid IPC response'));
        }
        client.end();
      }
    });

    client.on('error', (err) => {
      reject(new Error(`Failed to connect to paneful: ${err.message}`));
    });
  });
}
