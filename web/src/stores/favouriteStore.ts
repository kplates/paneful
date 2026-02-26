import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { PresetName } from '../lib/layout-engine';

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
}

export const useFavouriteStore = create<FavouriteState>()(
  persist(
    (set) => ({
      favourites: {},

      addFavourite: (favourite) =>
        set((s) => ({
          favourites: { ...s.favourites, [favourite.id]: favourite },
        })),

      updateFavourite: (id, updates) =>
        set((s) => {
          const existing = s.favourites[id];
          if (!existing) return s;
          return {
            favourites: {
              ...s.favourites,
              [id]: { ...existing, ...updates },
            },
          };
        }),

      removeFavourite: (id) =>
        set((s) => {
          const { [id]: _, ...rest } = s.favourites;
          return { favourites: rest };
        }),
    }),
    {
      name: 'paneful-favourites',
      partialize: (state) => ({
        favourites: state.favourites,
      }),
    }
  )
);
