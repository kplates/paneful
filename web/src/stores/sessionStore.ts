import { create } from 'zustand';
import { Terminal } from '@xterm/xterm';

interface TerminalSession {
  terminalId: string;
  projectId: string;
  terminal: Terminal | null;
  title: string;
  alive: boolean;
}

interface SessionState {
  sessions: Record<string, TerminalSession>;
  activePorts: Record<string, number[]>;
  claudeStatus: Record<string, 'active' | 'idle'>;
  gitBranches: Record<string, string | null>;

  createSession: (terminalId: string, projectId: string) => void;
  setTerminalInstance: (terminalId: string, terminal: Terminal) => void;
  setTitle: (terminalId: string, title: string) => void;
  markDead: (terminalId: string) => void;
  removeSession: (terminalId: string) => void;
  getSession: (terminalId: string) => TerminalSession | undefined;
  getProjectSessions: (projectId: string) => TerminalSession[];
  setActivePorts: (ports: Record<string, number[]>) => void;
  setClaudeStatus: (statuses: Record<string, 'active' | 'idle'>) => void;
  setGitBranches: (branches: Record<string, string | null>) => void;
}

export const useSessionStore = create<SessionState>((set, get) => ({
  sessions: {},
  activePorts: {},
  claudeStatus: {},
  gitBranches: {},

  createSession: (terminalId, projectId) =>
    set((s) => ({
      sessions: {
        ...s.sessions,
        [terminalId]: {
          terminalId,
          projectId,
          terminal: null,
          title: 'Terminal',
          alive: true,
        },
      },
    })),

  setTerminalInstance: (terminalId, terminal) =>
    set((s) => {
      const session = s.sessions[terminalId];
      if (!session) return s;
      return {
        sessions: { ...s.sessions, [terminalId]: { ...session, terminal } },
      };
    }),

  setTitle: (terminalId, title) =>
    set((s) => {
      const session = s.sessions[terminalId];
      if (!session) return s;
      return {
        sessions: { ...s.sessions, [terminalId]: { ...session, title } },
      };
    }),

  markDead: (terminalId) =>
    set((s) => {
      const session = s.sessions[terminalId];
      if (!session) return s;
      return {
        sessions: {
          ...s.sessions,
          [terminalId]: { ...session, alive: false },
        },
      };
    }),

  removeSession: (terminalId) =>
    set((s) => {
      const { [terminalId]: _, ...rest } = s.sessions;
      return { sessions: rest };
    }),

  getSession: (terminalId) => get().sessions[terminalId],

  getProjectSessions: (projectId) =>
    Object.values(get().sessions).filter((s) => s.projectId === projectId),

  setActivePorts: (ports) => set({ activePorts: ports }),

  setClaudeStatus: (statuses) => set({ claudeStatus: statuses }),

  setGitBranches: (branches) => set({ gitBranches: branches }),
}));
