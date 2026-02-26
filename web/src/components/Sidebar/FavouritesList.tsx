import React, { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Favourite } from '../../stores/favouriteStore';
import { FavouriteItem } from './FavouriteItem';

interface FavouritesListProps {
  favourites: Favourite[];
  onLaunch: (favourite: Favourite) => void;
  onEdit: (favourite: Favourite) => void;
  onDelete: (id: string) => void;
}

export function FavouritesList({ favourites, onLaunch, onEdit, onDelete }: FavouritesListProps) {
  const [collapsed, setCollapsed] = useState(false);

  if (favourites.length === 0) return null;

  return (
    <div>
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="
          flex items-center gap-1 w-full px-4 py-1.5
          text-[10px] font-semibold uppercase tracking-wider
          text-[var(--text-muted)] hover:text-[var(--text-secondary)]
          transition-colors
        "
      >
        {collapsed ? <ChevronRight size={10} /> : <ChevronDown size={10} />}
        Favourites
      </button>
      {!collapsed && (
        <div>
          {favourites.map((fav) => (
            <FavouriteItem
              key={fav.id}
              favourite={fav}
              onLaunch={() => onLaunch(fav)}
              onEdit={() => onEdit(fav)}
              onDelete={() => onDelete(fav.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
