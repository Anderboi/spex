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
    <div style={{ display: 'flex', gap: 12, marginTop: 'clamp(22px,4vw,34px)', flexWrap: 'wrap' }}>
      <div style={{ flex: 1, minWidth: 240, display: 'flex', alignItems: 'center', gap: 13, background: '#faf8f3', border: '1px solid #e6e1d5', borderRadius: 14, padding: '0 18px', height: 54 }}>
        <div style={{ width: 15, height: 15, border: '1.6px solid #b3aea2', borderRadius: '50%', position: 'relative', flex: 'none' }}><div style={{ position: 'absolute', width: 6, height: 1.6, background: '#b3aea2', right: -4, bottom: 0, transform: 'rotate(45deg)', transformOrigin: 'left' }}></div></div>
        <input value={queryInput} onChange={(e) => { const v = e.target.value; setQueryInput(v); clearTimeout(debounceTimer.current); debounceTimer.current = setTimeout(() => setQuery(v), 240); }} aria-label="Поиск по материалам" placeholder="Поиск по материалам, артикулам, брендам…" style={{ flex: 1, border: 'none', background: 'transparent', fontSize: 15.5, color: '#1b1a17', minWidth: 0, outline: 'none' }} />
        {queryInput.trim().length > 0 && <button onClick={() => { clearTimeout(debounceTimer.current); setQueryInput(''); setQuery(''); }} type="button" aria-label="Очистить поиск" style={{ flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 26, height: 26, borderRadius: 8, border: 'none', background: '#ece6da', color: '#46423a', cursor: 'pointer', fontSize: 14, lineHeight: 1 }}>✕</button>}
      </div>
      <button onClick={onSort} style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#faf8f3', border: '1px solid #e6e1d5', borderRadius: 14, padding: '0 20px', height: 54, fontFamily: "'JetBrains Mono',monospace", fontSize: 12.5, letterSpacing: '.04em', color: '#1b1a17', cursor: 'pointer', whiteSpace: 'nowrap' }}>{sortLabel} <span style={{ color: '#9a958a' }}>↕</span></button>
    </div>
  );
}