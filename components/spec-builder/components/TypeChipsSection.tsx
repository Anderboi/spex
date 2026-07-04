'use client';

import { TYPE_ORDER } from '../types';

interface TypeChipsSectionProps {
  activeType: string;
  setActiveType: (t: string) => void;
}

export default function TypeChipsSection({ activeType, setActiveType }: TypeChipsSectionProps) {
  return (
    <div style={{ display: 'flex', gap: 9, marginTop: 18, overflowX: 'auto', paddingBottom: 4 }}>
      {['Все типы', ...TYPE_ORDER].map(label => {
        const on = label === activeType;
        return <button key={label} onClick={() => setActiveType(label)} style={{ flex: 'none', padding: '11px 18px', borderRadius: 11, fontFamily: "'Space Grotesk',sans-serif", fontSize: 14, fontWeight: 500, cursor: 'pointer', whiteSpace: 'nowrap', background: on ? '#1b1a17' : '#faf8f3', color: on ? '#f3efe7' : '#4a463d', border: on ? '1px solid #1b1a17' : '1px solid #e6e1d5' }}>{label}</button>;
      })}
    </div>
  );
}