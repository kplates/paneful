import React, { useRef, useEffect, useState, useCallback } from 'react';
import { ChevronUp, ChevronDown, X } from 'lucide-react';
import { getSearchAddon } from '../../hooks/useTerminal';

const SEARCH_DECORATIONS = {
  matchBackground: undefined,
  matchBorder: '#facc15aa',
  matchOverviewRuler: '#facc15',
  activeMatchBackground: '#694d00',
  activeMatchBorder: '#fde047',
  activeMatchColorOverviewRuler: '#facc15',
};

interface SearchBarProps {
  terminalId: string;
  onClose: () => void;
}

export function SearchBar({ terminalId, onClose }: SearchBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const findNext = useCallback(() => {
    const addon = getSearchAddon(terminalId);
    if (addon && query) addon.findNext(query, { regex: false, caseSensitive: false, incremental: false, decorations: SEARCH_DECORATIONS });
  }, [terminalId, query]);

  const findPrevious = useCallback(() => {
    const addon = getSearchAddon(terminalId);
    if (addon && query) addon.findPrevious(query, { regex: false, caseSensitive: false, incremental: false, decorations: SEARCH_DECORATIONS });
  }, [terminalId, query]);

  const handleClose = useCallback(() => {
    const addon = getSearchAddon(terminalId);
    addon?.clearDecorations();
    onClose();
  }, [terminalId, onClose]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setQuery(val);
    const addon = getSearchAddon(terminalId);
    if (addon) {
      if (val) {
        addon.findNext(val, { regex: false, caseSensitive: false, incremental: true, decorations: SEARCH_DECORATIONS });
      } else {
        addon.clearDecorations();
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      handleClose();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) {
        findPrevious();
      } else {
        findNext();
      }
    }
  };

  return (
    <div
      className="flex items-center gap-2 px-3 py-2 bg-[var(--surface-2)] border-b border-[var(--border)]"
      onClick={(e) => e.stopPropagation()}
    >
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder="Search..."
        className="flex-1 min-w-0 bg-[var(--surface-0)] text-[var(--text-primary)] text-sm px-3 py-1.5 rounded-md border border-[var(--border)] outline-none focus:border-[var(--accent)] placeholder:text-[var(--text-muted)]"
      />
      <button
        onClick={findPrevious}
        className="p-1.5 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-3)] transition-colors"
        title="Previous match (Shift+Enter)"
      >
        <ChevronUp size={16} />
      </button>
      <button
        onClick={findNext}
        className="p-1.5 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-3)] transition-colors"
        title="Next match (Enter)"
      >
        <ChevronDown size={16} />
      </button>
      <button
        onClick={handleClose}
        className="p-1.5 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-3)] transition-colors"
        title="Close (Escape)"
      >
        <X size={16} />
      </button>
    </div>
  );
}
