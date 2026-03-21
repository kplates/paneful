// Client → Server
export type ClientMessage =
  | { type: 'pty:spawn'; terminalId: string; projectId: string; cwd: string }
  | { type: 'pty:input'; terminalId: string; data: string }
  | { type: 'pty:resize'; terminalId: string; cols: number; rows: number }
  | { type: 'pty:kill'; terminalId: string }
  | { type: 'project:kill'; projectId: string }
  | { type: 'project:create'; projectId: string; name: string; cwd: string }
  | { type: 'project:remove'; projectId: string }
  | { type: 'open:url'; url: string };

// Server → Client
export type ServerMessage =
  | { type: 'pty:output'; terminalId: string; data: string }
  | { type: 'pty:exit'; terminalId: string; exitCode: number }
  | { type: 'project:spawned'; projectId: string; name: string; cwd: string }
  | { type: 'editor:active'; projectName: string }
  | { type: 'port:status'; ports: Record<string, number[]> }
  | { type: 'claude:status'; statuses: Record<string, 'active' | 'idle'> }
  | { type: 'git:branch'; branches: Record<string, { branch: string; staged: number; modified: number; ahead: number; behind: number } | null> }
  | { type: 'inbox:paste'; files: string[] }
  | { type: 'error'; message: string };
