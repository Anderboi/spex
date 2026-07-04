'use client';

import { STATUS_FLOW } from '../types';
import { statusMeta } from '../utils';

interface StatusBadgeProps {
  status: string;
  accent: string;
  menuOpen: boolean;
  onToggleMenu: (e: React.MouseEvent) => void;
  onPick: (s: string) => void;
}

export default function StatusBadge({ status, accent, menuOpen, onToggleMenu, onPick }: StatusBadgeProps) {
  const m = statusMeta(status, accent);
  return (
    <>
      <span onClick={onToggleMenu} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '5px 8px 5px 11px', borderRadius: 20, fontSize: 12.5, fontWeight: 600, whiteSpace: 'nowrap', cursor: 'pointer', background: m.bg, color: m.fg, border: `1px solid ${m.bd}` }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', flex: 'none', background: 'currentColor', opacity: 0.8 }}></span>{status}<span style={{ fontSize: 9, opacity: 0.6, marginLeft: 1 }}>▾</span>
      </span>
      {menuOpen && (
        <div style={{ position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 40, minWidth: 182, background: '#faf8f3', border: '1px solid #d9d3c6', borderRadius: 13, padding: 6, boxShadow: '0 16px 40px rgba(27,26,23,.18)' }}>
          {STATUS_FLOW.map(s => {
            const sm2 = statusMeta(s, accent);
            return <div key={s} onClick={() => onPick(s)} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '9px 10px', borderRadius: 9, cursor: 'pointer', fontSize: 13.5, fontWeight: 500, color: '#1b1a17' }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', flex: 'none', background: sm2.dot }}></span><span style={{ flex: 1 }}>{s}</span><span style={{ color: '#1b1a17', fontSize: 12, width: 12, textAlign: 'right' }}>{s === status ? '✓' : ''}</span>
            </div>;
          })}
        </div>
      )}
    </>
  );
}