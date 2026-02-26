import React, { useState, useCallback } from 'react';
import { Plus, PanelLeftClose } from 'lucide-react';
import { useProjectStore } from '../../stores/projectStore';
import { useLayoutStore } from '../../stores/layoutStore';
import { useUIStore } from '../../stores/uiStore';
import { useFavouriteStore, Favourite, TerminalSlot } from '../../stores/favouriteStore';
import { sendMessage } from '../../hooks/useWebSocket';
import { setPendingCommand } from '../../hooks/useTerminal';
import { killProjectTerminals } from '../../lib/terminal-actions';
import { applyPreset, getTerminalIds, PresetName } from '../../lib/layout-engine';
import { ProjectItem } from './ProjectItem';
import { NewProjectDialog } from './NewProjectDialog';
import { FavouritesList } from './FavouritesList';
import { SaveFavouriteDialog } from './SaveFavouriteDialog';
import { LaunchFavouriteDialog } from './LaunchFavouriteDialog';

export function Sidebar() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [launchDialogOpen, setLaunchDialogOpen] = useState(false);
  const [editingFavourite, setEditingFavourite] = useState<Favourite | null>(null);
  const [pendingLaunch, setPendingLaunch] = useState<Favourite | null>(null);
  const [dropInitial, setDropInitial] = useState<{ name: string; cwd: string } | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const projects = useProjectStore((s) => s.projects);
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const setActiveProject = useProjectStore((s) => s.setActiveProject);
  const addProject = useProjectStore((s) => s.addProject);
  const removeProject = useProjectStore((s) => s.removeProject);
  const addTerminalToProject = useProjectStore((s) => s.addTerminalToProject);
  const sidebarOpen = useUIStore((s) => s.sidebarOpen);
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);
  const connectionStatus = useUIStore((s) => s.connectionStatus);
  const favourites = useFavouriteStore((s) => s.favourites);
  const addFavourite = useFavouriteStore((s) => s.addFavourite);
  const updateFavourite = useFavouriteStore((s) => s.updateFavourite);
  const removeFavourite = useFavouriteStore((s) => s.removeFavourite);

  const handleCreate = (name: string, cwd: string) => {
    const id = crypto.randomUUID();
    addProject({ id, name, cwd, terminalIds: [] });
    sendMessage({ type: 'project:create', projectId: id, name, cwd });
    setActiveProject(id);
  };

  const handleKill = (projectId: string) => {
    killProjectTerminals(projectId);
  };

  const handleRemove = (projectId: string) => {
    handleKill(projectId);
    sendMessage({ type: 'project:remove', projectId });
    useLayoutStore.getState().removeProjectLayout(projectId);
    removeProject(projectId);
  };

  const executeLaunch = (favourite: Favourite) => {
    if (!activeProjectId) return;
    const project = projects[activeProjectId];
    if (!project) return;

    // Kill existing terminals
    killProjectTerminals(activeProjectId);

    // Generate new terminal IDs
    const newIds = favourite.slots.map(() => crypto.randomUUID());

    // Set pending commands for slots that have them
    favourite.slots.forEach((slot, i) => {
      if (slot.command.trim()) {
        setPendingCommand(newIds[i], slot.command + '\n');
      }
    });

    // Apply preset layout
    const layout = applyPreset(newIds, favourite.preset);
    useLayoutStore.getState().setLayout(activeProjectId, layout);

    // Register terminal IDs in projectStore
    newIds.forEach((id) => {
      addTerminalToProject(activeProjectId, id);
    });

    // Focus first terminal
    if (newIds.length > 0) {
      useUIStore.getState().setFocusedTerminal(newIds[0]);
    }
  };

  const handleLaunchFavourite = (favourite: Favourite) => {
    if (!activeProjectId) return;

    const layout = useLayoutStore.getState().getLayout(activeProjectId);
    const existingIds = getTerminalIds(layout);

    if (existingIds.length > 0) {
      setPendingLaunch(favourite);
      setLaunchDialogOpen(true);
    } else {
      executeLaunch(favourite);
    }
  };

  const handleEditFavourite = (favourite: Favourite) => {
    setEditingFavourite(favourite);
    setEditDialogOpen(true);
  };

  const handleSaveEdit = (name: string, preset: PresetName, slots: TerminalSlot[]) => {
    if (editingFavourite) {
      updateFavourite(editingFavourite.id, { name, preset, slots });
    }
    setEditingFavourite(null);
  };

  const handleSidebarDragOver = useCallback((e: React.DragEvent) => {
    if (e.dataTransfer.types.includes('Files')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      setIsDragOver(true);
    }
  }, []);

  const handleSidebarDragLeave = useCallback((e: React.DragEvent) => {
    // Only clear if leaving the sidebar itself, not a child
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragOver(false);
    }
  }, []);

  const handleSidebarDrop = useCallback((e: React.DragEvent) => {
    setIsDragOver(false);
    if (!e.dataTransfer.types.includes('Files') || e.dataTransfer.files.length === 0) return;
    e.preventDefault();
    e.stopPropagation();

    // Resolve the dropped folder/file path via the server
    const file = e.dataTransfer.files[0];
    fetch('/api/resolve-path', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: file.name, size: file.size, lastModified: file.lastModified }),
    })
      .then((r) => r.json())
      .then((r: { path: string | null }) => {
        const resolvedPath = r.path || file.name;
        const folderName = resolvedPath.split('/').pop() || file.name;
        setDropInitial({ name: folderName, cwd: resolvedPath });
        setDialogOpen(true);
      })
      .catch(() => {
        // Fallback: use just the filename
        setDropInitial({ name: file.name, cwd: '~' });
        setDialogOpen(true);
      });
  }, []);

  if (!sidebarOpen) return null;

  const projectList = Object.values(projects);
  const favouriteList = Object.values(favourites);
  const activeProject = activeProjectId ? projects[activeProjectId] : null;
  const existingTerminalCount = activeProject
    ? getTerminalIds(useLayoutStore.getState().getLayout(activeProjectId!)).length
    : 0;

  return (
    <div
      className={`w-56 flex-shrink-0 bg-[var(--surface-1)] border-r border-[var(--border)] flex flex-col h-full ${isDragOver ? 'ring-2 ring-inset ring-[var(--accent)]' : ''}`}
      onDragOver={handleSidebarDragOver}
      onDragLeave={handleSidebarDragLeave}
      onDrop={handleSidebarDrop}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold tracking-tight text-[var(--text-primary)]">
            Paneful
          </span>
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              connectionStatus === 'connected'
                ? 'bg-[var(--success)]'
                : connectionStatus === 'connecting'
                ? 'bg-yellow-500 animate-pulse'
                : 'bg-[var(--danger)]'
            }`}
            title={connectionStatus}
          />
        </div>
        <button
          onClick={toggleSidebar}
          className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-3)] transition-colors"
          title="Hide sidebar"
        >
          <PanelLeftClose size={14} />
        </button>
      </div>

      {/* Project list + Favourites */}
      <div className="flex-1 overflow-y-auto py-2">
        {projectList.length === 0 && favouriteList.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <p className="text-xs text-[var(--text-muted)]">No projects yet</p>
          </div>
        ) : (
          <>
            {projectList.map((project) => (
              <ProjectItem
                key={project.id}
                project={project}
                isActive={project.id === activeProjectId}
                onClick={() => setActiveProject(project.id)}
                onKill={() => handleKill(project.id)}
                onRemove={() => handleRemove(project.id)}
              />
            ))}

            <FavouritesList
              favourites={favouriteList}
              onLaunch={handleLaunchFavourite}
              onEdit={handleEditFavourite}
              onDelete={removeFavourite}
            />
          </>
        )}
      </div>

      {/* Add button */}
      <div className="p-2 border-t border-[var(--border)]">
        <button
          onClick={() => setDialogOpen(true)}
          className="
            w-full flex items-center justify-center gap-1.5
            px-3 py-2 text-xs
            text-[var(--text-secondary)] hover:text-[var(--text-primary)]
            bg-[var(--surface-2)] hover:bg-[var(--surface-3)]
            rounded-lg transition-colors
          "
        >
          <Plus size={14} />
          New Project
        </button>
      </div>

      <NewProjectDialog
        open={dialogOpen}
        onClose={() => { setDialogOpen(false); setDropInitial(null); }}
        onCreate={handleCreate}
        initialName={dropInitial?.name}
        initialCwd={dropInitial?.cwd}
      />

      <SaveFavouriteDialog
        open={editDialogOpen}
        onClose={() => { setEditDialogOpen(false); setEditingFavourite(null); }}
        onSave={handleSaveEdit}
        editingFavourite={editingFavourite}
      />

      <LaunchFavouriteDialog
        open={launchDialogOpen}
        onClose={() => { setLaunchDialogOpen(false); setPendingLaunch(null); }}
        onConfirm={() => { if (pendingLaunch) executeLaunch(pendingLaunch); }}
        terminalCount={existingTerminalCount}
        favouriteName={pendingLaunch?.name ?? ''}
      />
    </div>
  );
}
