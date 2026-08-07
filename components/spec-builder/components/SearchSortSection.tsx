"use client";

import { Search } from 'lucide-react';

interface SearchSortSectionProps {
  queryInput: string;
  setQueryInput: (v: string) => void;
  setQuery: (v: string) => void;
  sortLabel: string;
  onSort: () => void;
  debounceTimer: React.MutableRefObject<
    ReturnType<typeof setTimeout> | undefined
  >;
}

export default function SearchSortSection({
  queryInput,
  setQueryInput,
  setQuery,
  sortLabel,
  onSort,
  debounceTimer,
}: SearchSortSectionProps) {
  return (
    <div className="flex gap-3 mt-[clamp(22px,4vw,34px)] flex-wrap">
      <div className="flex-1 min-w-60 h-10 flex items-center gap-3 bg-bg-card border border-border rounded-lg px-4 //h-10">
        
        <Search className="size-5 text-fg-icon"/>
        <input
          value={queryInput}
          onChange={(e) => {
            const v = e.target.value;
            setQueryInput(v);
            clearTimeout(debounceTimer.current);
            debounceTimer.current = setTimeout(() => setQuery(v), 240);
          }}
          aria-label="Поиск по материалам"
          placeholder="Поиск по материалам, артикулам, брендам…"
          className="flex-1 border-none bg-transparent text-[15.5px] text-fg min-w-0 outline-none"
        />
        {queryInput.trim().length > 0 && (
          <button
            onClick={() => {
              clearTimeout(debounceTimer.current);
              setQueryInput("");
              setQuery("");
            }}
            type="button"
            aria-label="Очистить поиск"
            className="flex-none flex items-center justify-center w-6 h-6 rounded-lg border-none bg-bg-clear text-fg-body cursor-pointer text-[14px] leading-none"
          >
            ✕
          </button>
        )}
      </div>
      <button
        onClick={onSort}
        className="flex items-center h-10 gap-2 bg-bg-card border border-border rounded-lg p-4 //h-13 font-mono text-[12px] tracking-[.04em] text-fg cursor-pointer whitespace-nowrap"
      >
        {sortLabel} <span className="text-fg-muted">↕</span>
      </button>
    </div>
  );
}
