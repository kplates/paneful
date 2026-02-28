import net from 'node:net';

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

export type IpcRequest = IpcSpawnRequest | IpcListRequest | IpcKillRequest;

export interface IpcOkResponse {
  status: 'ok';
  data?: string;
}

export interface IpcErrorResponse {
  status: 'error';
  message: string;
}

export type IpcResponse = IpcOkResponse | IpcErrorResponse;

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
