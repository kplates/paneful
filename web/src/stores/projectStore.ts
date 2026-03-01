import { create } from 'zustand';
import { persistSettings } from '../lib/persist';

export interface Project {
  id: string;
  name: string;
  cwd: string;
  terminalIds: string[];
}

interface ProjectState {
  projects: Record<string, Project>;
  activeProjectId: string | null;

  setActiveProject: (id: string | null) => void;
  addProject: (project: Project) => void;
  removeProject: (id: string) => void;
  addTerminalToProject: (projectId: string, terminalId: string) => void;
  removeTerminalFromProject: (projectId: string, terminalId: string) => void;
  clearProjectTerminals: (projectId: string) => void;
  getActiveProject: () => Project | null;
  hydrateFromServer: () => Promise<void>;
}

export const useProjectStore = create<ProjectState>()((set, get) => ({
  projects: {},
  activeProjectId: null,

  setActiveProject: (id) => {
    set({ activeProjectId: id });
    persistSettings({ activeProjectId: id });
  },

  addProject: (project) =>
    set((s) => ({
      projects: { ...s.projects, [project.id]: project },
      activeProjectId: s.activeProjectId ?? project.id,
    })),

  removeProject: (id) =>
    set((s) => {
      const { [id]: _, ...rest } = s.projects;
      const newActive =
        s.activeProjectId === id
          ? Object.keys(rest)[0] ?? null
          : s.activeProjectId;
      return { projects: rest, activeProjectId: newActive };
    }),

  addTerminalToProject: (projectId, terminalId) =>
    set((s) => {
      const project = s.projects[projectId];
      if (!project) return s;
      if (project.terminalIds.includes(terminalId)) return s;
      return {
        projects: {
          ...s.projects,
          [projectId]: {
            ...project,
            terminalIds: [...project.terminalIds, terminalId],
          },
        },
      };
    }),

  removeTerminalFromProject: (projectId, terminalId) =>
    set((s) => {
      const project = s.projects[projectId];
      if (!project) return s;
      return {
        projects: {
          ...s.projects,
          [projectId]: {
            ...project,
            terminalIds: project.terminalIds.filter((id) => id !== terminalId),
          },
        },
      };
    }),

  clearProjectTerminals: (projectId) =>
    set((s) => {
      const project = s.projects[projectId];
      if (!project) return s;
      return {
        projects: {
          ...s.projects,
          [projectId]: { ...project, terminalIds: [] },
        },
      };
    }),

  getActiveProject: () => {
    const { projects, activeProjectId } = get();
    return activeProjectId ? projects[activeProjectId] ?? null : null;
  },

  hydrateFromServer: async () => {
    try {
      const [projectsRes, settingsRes] = await Promise.all([
        fetch('/api/projects'),
        fetch('/api/settings'),
      ]);
      const serverProjects: { id: string; name: string; cwd: string; terminal_ids: string[] }[] =
        await projectsRes.json();
      const settings = await settingsRes.json();

      const projects: Record<string, Project> = {};
      for (const p of serverProjects) {
        projects[p.id] = {
          id: p.id,
          name: p.name,
          cwd: p.cwd,
          terminalIds: [],
        };
      }

      const activeProjectId =
        settings.activeProjectId && projects[settings.activeProjectId]
          ? settings.activeProjectId
          : Object.keys(projects)[0] ?? null;

      set({ projects, activeProjectId });
    } catch {
      // Server unavailable, keep defaults
    }
  },
}));
