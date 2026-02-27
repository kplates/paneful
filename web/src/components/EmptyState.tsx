import React, { useEffect, useState } from 'react';
import { Terminal, Plus } from 'lucide-react';

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

  return (
    <div className="h-full w-full flex items-center justify-center bg-[var(--surface-0)]">
      <div className="flex flex-col items-center gap-6 text-center max-w-lg px-8">
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
              flex items-center gap-2 px-4 py-2
              bg-accent hover:bg-accent/80
              text-white text-sm font-medium
              rounded-lg transition-colors
            "
          >
            <Plus size={16} />
            New Terminal
          </button>
        )}
        {blurb && (
          <div className="mt-4 max-w-sm">
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
