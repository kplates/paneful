import React, { useEffect, useState } from 'react';
import { Terminal, Plus } from 'lucide-react';

interface EmptyStateProps {
  onNewTerminal: () => void;
  projectName?: string;
}

function useMotivationalQuote() {
  const [quote, setQuote] = useState<{ text: string; author: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('https://dummyjson.com/quotes/random')
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled && data?.quote) {
          setQuote({ text: data.quote, author: data.author });
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  return quote;
}

export function EmptyState({ onNewTerminal, projectName }: EmptyStateProps) {
  const quote = useMotivationalQuote();

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
        {quote && (
          <div className="mt-4 max-w-sm">
            <p className="text-sm italic text-[var(--text-muted)] leading-relaxed">
              "{quote.text}"
            </p>
            <p className="text-xs text-[var(--text-muted)]/60 mt-2">
              — {quote.author}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
