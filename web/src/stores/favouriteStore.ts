import { create } from 'zustand';
import { PresetName } from '../lib/layout-engine';
import { persistSettings } from '../lib/persist';

export interface TerminalSlot {
  label: string;
  command: string;
}

export interface Favourite {
  id: string;
  name: string;
  preset: PresetName;
  slots: TerminalSlot[];
}

interface FavouriteState {
  favourites: Record<string, Favourite>;

  addFavourite: (favourite: Favourite) => void;
  updateFavourite: (id: string, updates: Partial<Omit<Favourite, 'id'>>) => void;
  removeFavourite: (id: string) => void;
  hydrateFromServer: () => Promise<void>;
}

export const useFavouriteStore = create<FavouriteState>()((set, get) => ({
  favourites: {},

  addFavourite: (favourite) => {
    set((s) => ({
      favourites: { ...s.favourites, [favourite.id]: favourite },
    }));
    persistSettings({ favourites: { ...get().favourites } });
  },

  updateFavourite: (id, updates) => {
    set((s) => {
      const existing = s.favourites[id];
      if (!existing) return s;
      return {
        favourites: {
          ...s.favourites,
          [id]: { ...existing, ...updates },
        },
      };
    });
    persistSettings({ favourites: { ...get().favourites } });
  },

  removeFavourite: (id) => {
    set((s) => {
      const { [id]: _, ...rest } = s.favourites;
      return { favourites: rest };
    });
    persistSettings({ favourites: { ...get().favourites } });
  },

  hydrateFromServer: async () => {
    try {
      const res = await fetch('/api/settings');
      const settings = await res.json();
      if (settings.favourites) {
        set({ favourites: settings.favourites });
      }
    } catch {
      // Server unavailable, keep defaults
    }
  },
}));
