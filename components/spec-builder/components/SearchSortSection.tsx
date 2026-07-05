'use client';

interface SearchSortSectionProps {
  queryInput: string;
  setQueryInput: (v: string) => void;
  setQuery: (v: string) => void;
  sortLabel: string;
  onSort: () => void;
  debounceTimer: React.MutableRefObject<ReturnType<typeof setTimeout> | undefined>;
}

export default function SearchSortSection({ queryInput, setQueryInput, setQuery, sortLabel, onSort, debounceTimer }: SearchSortSectionProps) {
  return (
    <div className="flex gap-3 mt-[clamp(22px,4vw,34px)] flex-wrap">
      <div className="flex-1 min-w-60 flex items-center gap-3 bg-bg-card border border-border rounded-[14px] px-4.5 h-13">
        <div className="size-4 border-[1.6px] border-fg-icon rounded-full relative flex-none">
          <div className="absolute w-1.5 h-[1.6px] bg-fg-icon -right-1 bottom-0 rotate-45 origin-left"></div>
        </div>
        <input value={queryInput} onChange={(e) => { const v = e.target.value; setQueryInput(v); clearTimeout(debounceTimer.current); debounceTimer.current = setTimeout(() => setQuery(v), 240); }} aria-label="Поиск по материалам" placeholder="Поиск по материалам, артикулам, брендам…" className="flex-1 border-none bg-transparent text-[15.5px] text-fg min-w-0 outline-none" />
        {queryInput.trim().length > 0 && <button onClick={() => { clearTimeout(debounceTimer.current); setQueryInput(''); setQuery(''); }} type="button" aria-label="Очистить поиск" className="flex-none flex items-center justify-center w-[26px] h-[26px] rounded-lg border-none bg-bg-clear text-fg-body cursor-pointer text-[14px] leading-none">✕</button>}
      </div>
      <button onClick={onSort} className="flex items-center gap-2.5 bg-bg-card border border-border rounded-[14px] px-5 h-13 font-mono text-[12.5px] tracking-[.04em] text-fg cursor-pointer whitespace-nowrap">{sortLabel} <span className="text-fg-muted">↕</span></button>
    </div>
  );
}