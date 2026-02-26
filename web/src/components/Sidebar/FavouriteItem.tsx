import React from 'react';
import { Star, Play, Pencil, Trash2, Terminal } from 'lucide-react';
import { Favourite } from '../../stores/favouriteStore';

const presetSubtitles: Record<string, string> = {
  'even-horizontal': 'Rows',
  'even-vertical': 'Columns',
  'main-left': 'Main + Stack',
  'main-top': 'Main + Row',
  grid: 'Grid',
};

interface FavouriteItemProps {
  favourite: Favourite;
  onLaunch: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

export function FavouriteItem({ favourite, onLaunch, onEdit, onDelete }: FavouriteItemProps) {
  const subtitle = `${presetSubtitles[favourite.preset] ?? favourite.preset}, ${favourite.slots.length} terminal${favourite.slots.length !== 1 ? 's' : ''}`;

  return (
    <div
      className="
        group flex items-center gap-2 px-3 py-2 mx-2 rounded-lg cursor-pointer
        text-[var(--text-secondary)] hover:bg-[var(--surface-2)] hover:text-[var(--text-primary)]
        transition-colors duration-100
      "
      onClick={onLaunch}
    >
      <Star size={14} className="text-[var(--text-muted)] flex-shrink-0" />

      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium truncate">{favourite.name}</div>
        <div className="text-[10px] text-[var(--text-muted)] truncate flex items-center gap-0.5">
          <Terminal size={8} />
          {subtitle}
        </div>
      </div>

      <div className="hidden group-hover:flex items-center gap-0.5">
        <button
          onClick={(e) => { e.stopPropagation(); onLaunch(); }}
          title="Launch"
          className="p-0.5 rounded text-[var(--text-muted)] hover:text-[var(--success)] hover:bg-green-500/10 transition-colors"
        >
          <Play size={12} />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onEdit(); }}
          title="Edit"
          className="p-0.5 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-3)] transition-colors"
        >
          <Pencil size={12} />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          title="Delete"
          className="p-0.5 rounded text-[var(--text-muted)] hover:text-[var(--danger)] hover:bg-[var(--danger-dim)] transition-colors"
        >
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  );
}
