import React, { useState, useRef, useEffect } from 'react';
import {
  X,
  Plus,
  Trash2,
  Rows2,
  Columns2,
  PanelLeft,
  PanelTop,
  Grid2X2,
} from 'lucide-react';
import { PresetName, PRESET_NAMES } from '../../lib/layout-engine';
import { Favourite, TerminalSlot } from '../../stores/favouriteStore';

const presetIcons: Record<PresetName, React.ReactNode> = {
  'even-horizontal': <Rows2 size={16} />,
  'even-vertical': <Columns2 size={16} />,
  'main-left': <PanelLeft size={16} />,
  'main-top': <PanelTop size={16} />,
  grid: <Grid2X2 size={16} />,
};

const presetLabels: Record<PresetName, string> = {
  'even-horizontal': 'Rows',
  'even-vertical': 'Columns',
  'main-left': 'Main + Stack',
  'main-top': 'Main + Row',
  grid: 'Grid',
};

interface SaveFavouriteDialogProps {
  open: boolean;
  onClose: () => void;
  onSave: (name: string, preset: PresetName, slots: TerminalSlot[]) => void;
  editingFavourite?: Favourite | null;
  defaultPreset?: PresetName;
  defaultSlotCount?: number;
}

export function SaveFavouriteDialog({
  open,
  onClose,
  onSave,
  editingFavourite,
  defaultPreset,
  defaultSlotCount,
}: SaveFavouriteDialogProps) {
  const [name, setName] = useState('');
  const [preset, setPreset] = useState<PresetName>('even-horizontal');
  const [slots, setSlots] = useState<TerminalSlot[]>([{ label: '', command: '' }]);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      if (editingFavourite) {
        setName(editingFavourite.name);
        setPreset(editingFavourite.preset);
        setSlots(editingFavourite.slots.map((s) => ({ ...s })));
      } else {
        setName('');
        setPreset(defaultPreset ?? 'even-horizontal');
        const count = defaultSlotCount ?? 1;
        setSlots(Array.from({ length: count }, () => ({ label: '', command: '' })));
      }
      setTimeout(() => nameRef.current?.focus(), 50);
    }
  }, [open, editingFavourite, defaultPreset, defaultSlotCount]);

  if (!open) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || slots.length === 0) return;
    onSave(name.trim(), preset, slots);
    onClose();
  };

  const addSlot = () => {
    setSlots([...slots, { label: '', command: '' }]);
  };

  const removeSlot = (index: number) => {
    if (slots.length <= 1) return;
    setSlots(slots.filter((_, i) => i !== index));
  };

  const updateSlot = (index: number, field: keyof TerminalSlot, value: string) => {
    setSlots(slots.map((s, i) => (i === index ? { ...s, [field]: value } : s)));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="bg-[var(--surface-1)] border border-[var(--border)] rounded-xl w-[440px] shadow-2xl animate-fade-in max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
          <h3 className="text-sm font-medium text-[var(--text-primary)]">
            {editingFavourite ? 'Edit Favourite' : 'Save Favourite'}
          </h3>
          <button
            onClick={onClose}
            className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-3)] transition-colors"
          >
            <X size={14} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-4 space-y-4 overflow-y-auto">
          {/* Name */}
          <div>
            <label className="block text-xs text-[var(--text-secondary)] mb-1.5">Name</label>
            <input
              ref={nameRef}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Workspace"
              className="
                w-full px-3 py-2 text-sm
                bg-[var(--surface-0)] border border-[var(--border)]
                text-[var(--text-primary)] placeholder:text-[var(--text-muted)]
                rounded-lg outline-none
                focus:border-accent focus:ring-1 focus:ring-accent/30
                transition-colors
              "
            />
          </div>

          {/* Preset picker */}
          <div>
            <label className="block text-xs text-[var(--text-secondary)] mb-1.5">Layout</label>
            <div className="flex gap-1">
              {PRESET_NAMES.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPreset(p)}
                  className={`
                    flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs transition-colors
                    ${preset === p
                      ? 'bg-accent/15 text-accent border border-accent/30'
                      : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-3)] border border-transparent'
                    }
                  `}
                  title={presetLabels[p]}
                >
                  {presetIcons[p]}
                  <span className="hidden sm:inline">{presetLabels[p]}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Terminal slots */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs text-[var(--text-secondary)]">Terminal Slots</label>
              <button
                type="button"
                onClick={addSlot}
                className="flex items-center gap-0.5 text-[10px] text-accent hover:text-accent/80 transition-colors"
              >
                <Plus size={10} />
                Add
              </button>
            </div>
            <div className="space-y-2">
              {slots.map((slot, i) => (
                <div key={i} className="flex items-start gap-2 p-2 rounded-lg bg-[var(--surface-0)] border border-[var(--border)]">
                  <div className="flex-1 space-y-1.5">
                    <input
                      value={slot.label}
                      onChange={(e) => updateSlot(i, 'label', e.target.value)}
                      placeholder={`Terminal ${i + 1}`}
                      className="
                        w-full px-2 py-1 text-xs
                        bg-transparent border border-[var(--border)]
                        text-[var(--text-primary)] placeholder:text-[var(--text-muted)]
                        rounded outline-none
                        focus:border-accent focus:ring-1 focus:ring-accent/30
                        transition-colors
                      "
                    />
                    <input
                      value={slot.command}
                      onChange={(e) => updateSlot(i, 'command', e.target.value)}
                      placeholder="Command (optional)"
                      className="
                        w-full px-2 py-1 text-xs font-mono
                        bg-transparent border border-[var(--border)]
                        text-[var(--text-primary)] placeholder:text-[var(--text-muted)]
                        rounded outline-none
                        focus:border-accent focus:ring-1 focus:ring-accent/30
                        transition-colors
                      "
                    />
                  </div>
                  {slots.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeSlot(i)}
                      className="p-1 mt-0.5 rounded text-[var(--text-muted)] hover:text-[var(--danger)] hover:bg-[var(--danger-dim)] transition-colors"
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="
                px-3 py-1.5 text-xs text-[var(--text-secondary)]
                hover:text-[var(--text-primary)] hover:bg-[var(--surface-3)]
                rounded-lg transition-colors
              "
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!name.trim() || slots.length === 0}
              className="
                px-3 py-1.5 text-xs font-medium
                bg-accent hover:bg-accent/80
                disabled:opacity-40 disabled:cursor-not-allowed
                text-white rounded-lg transition-colors
              "
            >
              {editingFavourite ? 'Update' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
