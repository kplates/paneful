import { create } from 'zustand';
import { persist } from 'zustand/middleware';

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
}

export const useProjectStore = create<ProjectState>()(
  persist(
    (set, get) => ({
      projects: {},
      activeProjectId: null,

      setActiveProject: (id) => set({ activeProjectId: id }),

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
    }),
    {
      name: 'paneful-projects',
      partialize: (state) => ({
        projects: state.projects,
        activeProjectId: state.activeProjectId,
      }),
      onRehydrateStorage: () => (state) => {
        // Terminal IDs are stale after a page reload — the backend PTYs are gone.
        // Clear them so the UI doesn't show ghost terminals.
        if (!state) return;
        const cleaned: Record<string, Project> = {};
        for (const [id, project] of Object.entries(state.projects)) {
          cleaned[id] = { ...project, terminalIds: [] };
        }
        state.projects = cleaned;
      },
    }
  )
);
