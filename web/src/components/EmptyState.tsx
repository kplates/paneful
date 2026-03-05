import React, { useEffect, useState } from 'react';
import { Terminal, Plus, Star, Play } from 'lucide-react';
import { useFavouriteStore, Favourite } from '../stores/favouriteStore';
import { useUIStore } from '../stores/uiStore';

interface EmptyStateProps {
  onNewTerminal: () => void;
  projectName?: string;
}

function useRandomBlurb() {
  const [blurb, setBlurb] = useState<{ text: string; attribution?: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const showQuote = Math.random() < 0.5;

    if (showQuote) {
      fetch('https://dummyjson.com/quotes/random')
        .then((res) => res.json())
        .then((data) => {
          if (!cancelled && data?.quote) {
            setBlurb({ text: data.quote, attribution: data.author });
          }
        })
        .catch(() => {});
    } else {
      fetch('https://uselessfacts.jsph.pl/api/v2/facts/random?language=en')
        .then((res) => res.json())
        .then((data) => {
          if (!cancelled && data?.text) {
            setBlurb({ text: data.text });
          }
        })
        .catch(() => {});
    }

    return () => { cancelled = true; };
  }, []);

  return blurb;
}

export function EmptyState({ onNewTerminal, projectName }: EmptyStateProps) {
  const blurb = useRandomBlurb();
  const favourites = useFavouriteStore((s) => s.favourites);
  const favouriteList = Object.values(favourites);

  return (
    <div className="h-full w-full flex items-center justify-center bg-[var(--surface-0)]">
      <div className="flex flex-col items-center gap-8 text-center max-w-md px-8">
        {/* Hero */}
        <div className="flex flex-col items-center gap-4">
          <div className="w-16 h-16 rounded-2xl bg-[var(--surface-2)] border border-[var(--border)] flex items-center justify-center">
            <Terminal size={28} className="text-[var(--text-muted)]" />
          </div>
          <div>
            <h2 className="text-lg font-medium text-[var(--text-primary)] mb-1">
              {projectName ?? 'No project selected'}
            </h2>
            <p className="text-sm text-[var(--text-muted)]">
              {projectName
                ? 'This project has no active terminals.'
                : 'Create a project to get started.'}
            </p>
          </div>
          {projectName && (
            <button
              onClick={onNewTerminal}
              className="
                flex items-center gap-2 px-5 py-2.5
                bg-accent hover:bg-accent/80
                text-white text-sm font-medium
                rounded-lg transition-colors
              "
            >
              <Plus size={16} />
              New Terminal
            </button>
          )}
        </div>

        {/* Favourites */}
        {projectName && favouriteList.length > 0 && (
          <div className="w-full rounded-xl bg-[var(--surface-1)] border border-[var(--border)] p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-3 text-left flex items-center gap-1.5">
              <Star size={11} />
              Favourites
            </p>
            <div className="space-y-1.5">
              {favouriteList.map((fav) => (
                <button
                  key={fav.id}
                  onClick={() => useUIStore.getState().requestFavouriteLaunch(fav.id)}
                  className="
                    group w-full flex items-center gap-2.5 px-3 py-2.5
                    bg-[var(--surface-2)] hover:bg-[var(--surface-3)]
                    text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]
                    rounded-lg transition-colors text-left
                  "
                >
                  <Play size={12} className="text-[var(--text-muted)] group-hover:text-[var(--accent)] shrink-0 transition-colors" />
                  <span className="truncate font-medium">{fav.name}</span>
                  <span className="ml-auto text-[10px] text-[var(--text-muted)] tabular-nums shrink-0">
                    {fav.slots.length} pane{fav.slots.length !== 1 ? 's' : ''}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Quote / fun fact */}
        {blurb && (
          <div className="max-w-sm">
            <p className="text-sm italic text-[var(--text-muted)] leading-relaxed">
              "{blurb.text}"
            </p>
            {blurb.attribution && (
              <p className="text-xs text-[var(--text-muted)]/60 mt-2">
                — {blurb.attribution}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
