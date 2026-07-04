'use client';

interface HeaderSectionProps {
  saveStatus: 'idle' | 'saving' | 'saved';
  mobMenuOpen: boolean;
  setMobMenuOpen: (v: boolean) => void;
  setProcureOpen: (v: boolean) => void;
  setSummaryOpen: (v: boolean) => void;
  setAddOpen: () => void;
}

export default function HeaderSection({
  saveStatus, mobMenuOpen, setMobMenuOpen, setProcureOpen, setSummaryOpen, setAddOpen
}: HeaderSectionProps) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap', paddingTop: 'clamp(28px,5vw,48px)' }}>
      <div style={{ width: '100%' }}>
        <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11.5, letterSpacing: '.1em', textTransform: 'uppercase', color: '#9a958a', display: 'flex', gap: 10, alignItems: 'center' }}>
          <span>Седьмой тестовый проект</span><span style={{ opacity: 0.5 }}>/</span><span style={{ color: '#1b1a17' }}>Спецификации</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, width: '100%' }}>
          <h1 style={{ fontSize: 'clamp(34px,6vw,54px)', fontWeight: 700, letterSpacing: '-.02em', margin: '12px 0 0 0', lineHeight: 0.98 }}>Спецификации</h1>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', width: '100%', justifyContent: 'flex-end' }}>
        <div role="status" aria-live="polite" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 6px', fontFamily: "'JetBrains Mono',monospace", fontSize: 11.5, letterSpacing: '.02em', color: '#6a665a', whiteSpace: 'nowrap' }}>
          {saveStatus === 'saving' && <span style={{ width: 9, height: 9, borderRadius: '50%', flex: 'none', background: '#b07d1e' }}></span>}
          {saveStatus === 'saved' && <span style={{ width: 9, height: 9, borderRadius: '50%', flex: 'none', background: '#5f7a3f' }}></span>}
          <span>{saveStatus === 'saving' ? 'Сохранение…' : 'Сохранено'}</span>
        </div>
        <button onClick={() => setProcureOpen(true)} style={{ display: 'flex', alignItems: 'center', gap: 9, background: '#faf8f3', color: '#1b1a17', border: '1px solid #d9d3c6', borderRadius: 13, padding: '14px 20px', fontFamily: "'Space Grotesk',sans-serif", fontSize: 15, fontWeight: 600, cursor: 'pointer' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 16 }}><span style={{ width: 7, height: 7, borderRadius: '50%', background: '#5f7a3f' }}></span><span style={{ width: 7, height: 7, borderRadius: '50%', background: '#3f6b80' }}></span></span>&nbsp;Закупка
        </button>
        <button onClick={() => setSummaryOpen(true)} style={{ display: 'flex', alignItems: 'center', gap: 9, background: '#faf8f3', color: '#1b1a17', border: '1px solid #d9d3c6', borderRadius: 13, padding: '14px 20px', fontFamily: "'Space Grotesk',sans-serif", fontSize: 15, fontWeight: 600, cursor: 'pointer' }}>
          <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 2.5, width: 13, fontSize: 16 }}><span style={{ height: 1.7, background: 'currentColor', borderRadius: 2 }}></span><span style={{ height: 1.7, width: 9, background: 'currentColor', borderRadius: 2 }}></span><span style={{ height: 1.7, background: 'currentColor', borderRadius: 2 }}></span></span>Экспорт
        </button>
        <button onClick={setAddOpen} style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#1b1a17', color: '#f3efe7', border: 'none', borderRadius: 13, padding: '15px 22px', fontFamily: "'Space Grotesk',sans-serif", fontSize: 15, fontWeight: 600, cursor: 'pointer' }}>
          <span style={{ fontSize: 18, lineHeight: 1, marginTop: -2 }}>+</span> Добавить материал
        </button>
      </div>
    </div>
  );
}