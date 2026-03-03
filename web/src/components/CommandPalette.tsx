import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  Folder, Star, Columns2, Rows2, PanelLeft, PanelTop, Grid2X2,
  Plus, X, PanelLeftClose, MonitorSmartphone, LayoutDashboard,
  Search, Command,
} from 'lucide-react';
import { useUIStore } from '../stores/uiStore';
import { useProjectStore } from '../stores/projectStore';
import { useLayoutStore } from '../stores/layoutStore';
import { useFavouriteStore } from '../stores/favouriteStore';
import { useSessionStore } from '../stores/sessionStore';
import { sendMessage } from '../hooks/useWebSocket';
import { cleanupTerminal } from '../hooks/useTerminal';
import { getTerminalIds, applyPreset, PRESET_NAMES } from '../lib/layout-engine';
import type { PresetName } from '../lib/layout-engine';

interface PaletteItem {
  id: string;
  label: string;
  category: string;
  icon: React.ReactNode;
  shortcut?: string;
  action: () => void;
}

export function CommandPalette() {
  const isOpen = useUIStore((s) => s.commandPaletteOpen);
  const close = useUIStore((s) => s.closeCommandPalette);

  if (!isOpen) return null;
  return <CommandPaletteInner onClose={close} />;
}

function CommandPaletteInner({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const items = useMemo(() => buildItems(onClose), [onClose]);

  const filtered = useMemo(() => {
    if (!query.trim()) return items;
    const q = query.toLowerCase();
    return items.filter((item) => item.label.toLowerCase().includes(q));
  }, [items, query]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  const execute = useCallback((item: PaletteItem) => {
    item.action();
    onClose();
  }, [onClose]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (filtered[selectedIndex]) {
        execute(filtered[selectedIndex]);
      }
      return;
    }
  };

  // Scroll selected item into view
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const el = list.children[selectedIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="max-w-lg mx-auto mt-[20vh] bg-[var(--surface-1)] border border-[var(--border)] rounded-xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--border)]">
          <Search size={16} className="text-[var(--text-muted)] shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search commands..."
            className="flex-1 bg-transparent text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
          />
          <kbd className="hidden sm:inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-[var(--surface-3)] text-[10px] text-[var(--text-muted)] font-mono">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-72 overflow-y-auto py-1">
          {filtered.length === 0 ? (
            <div className="px-4 py-6 text-center text-xs text-[var(--text-muted)]">
              No matching commands
            </div>
          ) : (
            filtered.map((item, i) => (
              <button
                key={item.id}
                onClick={() => execute(item)}
                onMouseEnter={() => setSelectedIndex(i)}
                className={`
                  w-full flex items-center gap-3 px-4 py-2 text-left transition-colors
                  ${i === selectedIndex
                    ? 'bg-[var(--surface-2)] text-[var(--text-primary)]'
                    : 'text-[var(--text-secondary)] hover:bg-[var(--surface-2)]'
                  }
                `}
              >
                <span className="shrink-0 text-[var(--text-muted)]">{item.icon}</span>
                <span className="flex-1 text-xs truncate">{item.label}</span>
                <span className="shrink-0 text-[9px] px-1.5 py-0.5 rounded bg-[var(--surface-3)] text-[var(--text-muted)]">
                  {item.category}
                </span>
                {item.shortcut && (
                  <kbd className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-[var(--surface-3)] text-[var(--text-muted)] font-mono">
                    {item.shortcut}
                  </kbd>
                )}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function buildItems(onClose: () => void): PaletteItem[] {
  const items: PaletteItem[] = [];
  const projects = useProjectStore.getState().projects;
  const favourites = useFavouriteStore.getState().favourites;
  const activeProjectId = useProjectStore.getState().activeProjectId;

  // Projects
  for (const project of Object.values(projects)) {
    items.push({
      id: `project:${project.id}`,
      label: `Switch to ${project.name}`,
      category: 'Project',
      icon: <Folder size={14} />,
      action: () => {
        useProjectStore.getState().setActiveProject(project.id);
      },
    });
  }

  // Favourites
  for (const fav of Object.values(favourites)) {
    items.push({
      id: `fav:${fav.id}`,
      label: `Launch ${fav.name}`,
      category: 'Favourite',
      icon: <Star size={14} />,
      action: () => {
        useUIStore.getState().requestFavouriteLaunch(fav.id);
      },
    });
  }

  // Layout presets
  const presetMeta: Record<PresetName, { label: string; icon: React.ReactNode }> = {
    'even-horizontal': { label: 'Layout: Rows', icon: <Rows2 size={14} /> },
    'even-vertical': { label: 'Layout: Columns', icon: <Columns2 size={14} /> },
    'main-left': { label: 'Layout: Main + Stack', icon: <PanelLeft size={14} /> },
    'main-top': { label: 'Layout: Main + Row', icon: <PanelTop size={14} /> },
    grid: { label: 'Layout: Grid', icon: <Grid2X2 size={14} /> },
  };
  for (const preset of PRESET_NAMES) {
    const meta = presetMeta[preset];
    items.push({
      id: `layout:${preset}`,
      label: meta.label,
      category: 'Layout',
      icon: meta.icon,
      action: () => {
        if (!activeProjectId) return;
        const layout = useLayoutStore.getState().getLayout(activeProjectId);
        const ids = getTerminalIds(layout);
        if (ids.length === 0) return;
        const newLayout = applyPreset(ids, preset);
        if (newLayout) useLayoutStore.getState().setLayout(activeProjectId, newLayout);
      },
    });
  }

  // Actions
  items.push({
    id: 'action:new-pane-v',
    label: 'New pane (vertical)',
    category: 'Action',
    icon: <Plus size={14} />,
    shortcut: '\u2318N',
    action: () => {
      if (!activeProjectId) return;
      const layout = useLayoutStore.getState().getLayout(activeProjectId);
      const ids = getTerminalIds(layout);
      const focused = useUIStore.getState().focusedTerminalId;
      const newId = crypto.randomUUID();
      const refId = focused ?? ids[ids.length - 1];
      if (refId) {
        useLayoutStore.getState().addPaneToProject(activeProjectId, refId, newId, 'vertical');
      } else {
        useLayoutStore.getState().setLayout(activeProjectId, { type: 'leaf', terminalId: newId });
      }
      useProjectStore.getState().addTerminalToProject(activeProjectId, newId);
      useUIStore.getState().setFocusedTerminal(newId);
    },
  });

  items.push({
    id: 'action:new-pane-h',
    label: 'New pane (horizontal)',
    category: 'Action',
    icon: <Plus size={14} />,
    shortcut: '\u2318\u21E7N',
    action: () => {
      if (!activeProjectId) return;
      const layout = useLayoutStore.getState().getLayout(activeProjectId);
      const ids = getTerminalIds(layout);
      const focused = useUIStore.getState().focusedTerminalId;
      const newId = crypto.randomUUID();
      const refId = focused ?? ids[ids.length - 1];
      if (refId) {
        useLayoutStore.getState().addPaneToProject(activeProjectId, refId, newId, 'horizontal');
      } else {
        useLayoutStore.getState().setLayout(activeProjectId, { type: 'leaf', terminalId: newId });
      }
      useProjectStore.getState().addTerminalToProject(activeProjectId, newId);
      useUIStore.getState().setFocusedTerminal(newId);
    },
  });

  items.push({
    id: 'action:close-pane',
    label: 'Close pane',
    category: 'Action',
    icon: <X size={14} />,
    shortcut: '\u2318W',
    action: () => {
      if (!activeProjectId) return;
      const focused = useUIStore.getState().focusedTerminalId;
      if (!focused) return;
      sendMessage({ type: 'pty:kill', terminalId: focused });
      useLayoutStore.getState().removePaneFromProject(activeProjectId, focused);
      useProjectStore.getState().removeTerminalFromProject(activeProjectId, focused);
      const session = useSessionStore.getState().sessions[focused];
      session?.terminal?.dispose();
      useSessionStore.getState().removeSession(focused);
      cleanupTerminal(focused);
      const remaining = getTerminalIds(useLayoutStore.getState().getLayout(activeProjectId));
      useUIStore.getState().setFocusedTerminal(remaining[0] ?? null);
    },
  });

  items.push({
    id: 'action:toggle-sidebar',
    label: 'Toggle sidebar',
    category: 'Action',
    icon: <PanelLeftClose size={14} />,
    shortcut: '\u2318D',
    action: () => {
      useUIStore.getState().toggleSidebar();
    },
  });

  items.push({
    id: 'action:cycle-theme',
    label: 'Cycle theme',
    category: 'Action',
    icon: <MonitorSmartphone size={14} />,
    action: () => {
      useUIStore.getState().cycleTheme();
    },
  });

  items.push({
    id: 'action:toggle-editor-sync',
    label: 'Toggle editor sync',
    category: 'Action',
    icon: <MonitorSmartphone size={14} />,
    action: () => {
      useUIStore.getState().toggleEditorSync();
    },
  });

  items.push({
    id: 'action:auto-reorganize',
    label: 'Auto reorganize',
    category: 'Action',
    icon: <LayoutDashboard size={14} />,
    shortcut: '\u2318R',
    action: () => {
      if (!activeProjectId) return;
      const layout = useLayoutStore.getState().getLayout(activeProjectId);
      const ids = getTerminalIds(layout);
      if (ids.length === 0) return;
      let preset: PresetName;
      if (ids.length <= 2) preset = 'even-vertical';
      else if (ids.length === 3) preset = 'main-left';
      else preset = 'grid';
      const newLayout = applyPreset(ids, preset);
      if (newLayout) useLayoutStore.getState().setLayout(activeProjectId, newLayout);
    },
  });

  return items;
}
