import React, { useState } from 'react';
import {
  Plus,
  Columns2,
  Rows2,
  LayoutGrid,
  PanelLeft,
  PanelTop,
  Grid2X2,
  PanelLeftOpen,
  Info,
  LayoutDashboard,
  Star,
} from 'lucide-react';
import { useUIStore } from '../../stores/uiStore';
import { useProjectStore } from '../../stores/projectStore';
import { useLayoutStore } from '../../stores/layoutStore';
import { useFavouriteStore, TerminalSlot } from '../../stores/favouriteStore';
import { getTerminalIds, applyPreset } from '../../lib/layout-engine';
import { PRESET_NAMES, PresetName } from '../../lib/layout-engine';
import { SaveFavouriteDialog } from '../Sidebar/SaveFavouriteDialog';
import { ShortcutsDialog } from '../ShortcutsDialog';

const presetIcons: Record<PresetName, React.ReactNode> = {
  'even-horizontal': <Rows2 size={14} />,
  'even-vertical': <Columns2 size={14} />,
  'main-left': <PanelLeft size={14} />,
  'main-top': <PanelTop size={14} />,
  grid: <Grid2X2 size={14} />,
};

const presetLabels: Record<PresetName, string> = {
  'even-horizontal': 'Rows',
  'even-vertical': 'Columns',
  'main-left': 'Main + Stack',
  'main-top': 'Main + Row',
  grid: 'Grid',
};

interface ToolbarProps {
  onNewPane: (direction: 'vertical' | 'horizontal') => void;
}

export function Toolbar({ onNewPane }: ToolbarProps) {
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  const sidebarOpen = useUIStore((s) => s.sidebarOpen);
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const currentPresetIndex = useLayoutStore((s) => s.currentPresetIndex);
  const cyclePreset = useLayoutStore((s) => s.cyclePreset);
  const addFavourite = useFavouriteStore((s) => s.addFavourite);

  const handlePresetCycle = () => {
    if (!activeProjectId) return;
    const layout = useLayoutStore.getState().getLayout(activeProjectId);
    const ids = getTerminalIds(layout);
    if (ids.length > 0) {
      cyclePreset(activeProjectId, ids);
    }
  };

  const handleAutoReorganize = () => {
    if (!activeProjectId) return;
    const layout = useLayoutStore.getState().getLayout(activeProjectId);
    const ids = getTerminalIds(layout);
    if (ids.length === 0) return;
    // Pick best layout based on pane count
    let preset: PresetName;
    if (ids.length <= 2) preset = 'even-vertical';
    else if (ids.length === 3) preset = 'main-left';
    else preset = 'grid';
    const newLayout = applyPreset(ids, preset);
    if (newLayout) useLayoutStore.getState().setLayout(activeProjectId, newLayout);
  };

  const handleSaveFavourite = (name: string, preset: PresetName, slots: TerminalSlot[]) => {
    addFavourite({
      id: crypto.randomUUID(),
      name,
      preset,
      slots,
    });
  };

  const currentPreset = PRESET_NAMES[currentPresetIndex];

  // Get current terminal count for pre-populating the save dialog
  const currentTerminalCount = activeProjectId
    ? getTerminalIds(useLayoutStore.getState().getLayout(activeProjectId)).length
    : 0;

  return (
    <div className="h-9 flex-shrink-0 flex items-center px-2 gap-1 bg-[var(--surface-1)] border-b border-[var(--border)]">
      {/* Sidebar toggle */}
      {!sidebarOpen && (
        <button
          onClick={toggleSidebar}
          className="p-1.5 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-3)] transition-colors"
          title="Show sidebar (Cmd+D)"
        >
          <PanelLeftOpen size={14} />
        </button>
      )}

      <div className="w-px h-4 bg-[var(--border)] mx-1" />

      {/* Split buttons */}
      <button
        onClick={() => onNewPane('vertical')}
        className="p-1.5 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-3)] transition-colors"
        title="Split vertical (Cmd+N)"
      >
        <Columns2 size={14} />
      </button>
      <button
        onClick={() => onNewPane('horizontal')}
        className="p-1.5 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-3)] transition-colors"
        title="Split horizontal (Cmd+Shift+N)"
      >
        <Rows2 size={14} />
      </button>

      <div className="w-px h-4 bg-[var(--border)] mx-1" />

      {/* Layout preset */}
      <button
        onClick={handlePresetCycle}
        className="flex items-center gap-1.5 px-2 py-1 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-3)] transition-colors text-xs"
        title="Cycle layout (Cmd+T)"
      >
        {presetIcons[currentPreset]}
        <span className="hidden sm:inline">{presetLabels[currentPreset]}</span>
      </button>

      {/* Auto reorganize */}
      <button
        onClick={handleAutoReorganize}
        className="p-1.5 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-3)] transition-colors"
        title="Auto reorganize (Cmd+R)"
      >
        <LayoutDashboard size={14} />
      </button>

      <div className="w-px h-4 bg-[var(--border)] mx-1" />

      {/* Save favourite */}
      <button
        onClick={() => setSaveDialogOpen(true)}
        className="p-1.5 rounded text-[var(--text-muted)] hover:text-yellow-400 hover:bg-[var(--surface-3)] transition-colors"
        title="Save as favourite"
      >
        <Star size={14} />
      </button>

      <div className="flex-1" />

      {/* Keyboard shortcuts */}
      <button
        onClick={() => setShortcutsOpen(true)}
        className="p-1.5 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-3)] transition-colors"
        title="Keyboard shortcuts"
      >
        <Info size={14} />
      </button>

      <SaveFavouriteDialog
        open={saveDialogOpen}
        onClose={() => setSaveDialogOpen(false)}
        onSave={handleSaveFavourite}
        defaultPreset={currentPreset}
        defaultSlotCount={Math.max(currentTerminalCount, 1)}
      />

      <ShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    </div>
  );
}
