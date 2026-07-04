'use client';

import { STATUS_FLOW } from '../types';
import { statusMeta } from '../utils';

interface BottomBarProps {
  totalCount: number;
  totalSum: string;
  selectionActive: boolean;
  selCount: number;
  selSumStr: string;
  allVisibleSelected: boolean;
  visIds: string[];
  selected: Record<string, boolean>;
  bulkMenuOpen: boolean;
  setBulkMenuOpen: (v: boolean) => void;
  onClearSel: () => void;
  onSelectAllVisible: () => void;
  onBulkDelete: () => void;
  bulkStatus: (s: string) => void;
}

export default function BottomBar({
  totalCount, totalSum, selectionActive, selCount, selSumStr,
  allVisibleSelected, visIds, selected, bulkMenuOpen, setBulkMenuOpen,
  onClearSel, onSelectAllVisible, onBulkDelete, bulkStatus
}: BottomBarProps) {
  return (
    <div style={{ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 50, display: 'flex', justifyContent: 'center', padding: '0 clamp(16px,4vw,48px) clamp(16px,3vw,28px)', pointerEvents: 'none' }}>
      <div style={{ width: '100%', maxWidth: 1180, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, background: '#1b1a17', color: '#f3efe7', borderRadius: 16, padding: '18px clamp(18px,3vw,30px)', boxShadow: '0 18px 50px rgba(27,26,23,.28)', pointerEvents: 'auto' }}>
        {!selectionActive ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, width: '100%' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
              <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10.5, letterSpacing: '.12em', textTransform: 'uppercase', color: '#8d887d' }}>Позиций</span>
              <span style={{ fontSize: 'clamp(20px,4vw,26px)', fontWeight: 700 }}>{totalCount}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 14 }}>
              <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10.5, letterSpacing: '.12em', textTransform: 'uppercase', color: '#8d887d' }}>Сумма</span>
              <span style={{ fontSize: 'clamp(22px,5vw,30px)', fontWeight: 700, letterSpacing: '-.01em' }}>{totalSum} ₽</span>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, width: '100%', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 11 }}>
              <span style={{ fontSize: 'clamp(19px,3.5vw,24px)', fontWeight: 700 }}>{selCount}</span>
              <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10.5, letterSpacing: '.1em', textTransform: 'uppercase', color: '#8d887d' }}>выбрано · {selSumStr} ₽</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span onClick={onSelectAllVisible} style={{ background: 'transparent', border: '1px solid rgba(243,239,231,.28)', color: '#f3efe7', borderRadius: 9, padding: '8px 13px', fontFamily: "'Space Grotesk',sans-serif", fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>{allVisibleSelected ? 'Снять все' : 'Выбрать все'}</span>
              <div style={{ position: 'relative' }}>
                <span onClick={() => setBulkMenuOpen(!bulkMenuOpen)} style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'transparent', border: '1px solid rgba(243,239,231,.28)', color: '#f3efe7', borderRadius: 9, padding: '8px 13px', fontFamily: "'Space Grotesk',sans-serif", fontSize: 13, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>Статус <span style={{ fontSize: 9, opacity: 0.7 }}>▾</span></span>
                {bulkMenuOpen && (
                  <div style={{ position: 'absolute', bottom: 'calc(100% + 9px)', left: 0, zIndex: 60, minWidth: 192, background: '#faf8f3', border: '1px solid #d9d3c6', borderRadius: 13, padding: 6, boxShadow: '0 18px 44px rgba(27,26,23,.3)' }}>
                    <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 9, letterSpacing: '.1em', textTransform: 'uppercase', color: '#9a958a', padding: '6px 10px 5px' }}>Назначить статус</div>
                    {STATUS_FLOW.map(s => <div key={s} onClick={() => { bulkStatus(s); setBulkMenuOpen(false); }} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '9px 10px', borderRadius: 9, cursor: 'pointer', color: '#1b1a17', fontSize: 13.5, fontWeight: 500 }}><span style={{ width: 8, height: 8, borderRadius: '50%', flex: 'none', background: statusMeta(s, '#1b1a17').dot }}></span>{s}</div>)}
                  </div>
                )}
              </div>
              <span onClick={onBulkDelete} style={{ background: 'transparent', border: '1px solid rgba(231,160,150,.5)', color: '#f0b3a8', borderRadius: 9, padding: '8px 13px', fontFamily: "'Space Grotesk',sans-serif", fontSize: 13, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>Удалить {selCount}</span>
              <span onClick={onClearSel} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 34, height: 34, borderRadius: 9, border: '1px solid rgba(243,239,231,.28)', color: '#f3efe7', cursor: 'pointer', fontSize: 15 }}>✕</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}