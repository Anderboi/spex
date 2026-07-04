'use client';

import { SpecItem } from '../types';
import { fmt, brandSite } from '../utils';
import StatusBadge from './StatusBadge';

interface SpecRowProps {
  it: SpecItem;
  selected: boolean;
  accent: string;
  dragId: string | null;
  dragOverId: string | null;
  statusMenuId: string | null;
  setStatusMenuId: (id: string | null) => void;
  setStatus: (id: string, s: string) => void;
  onOpen: () => void;
  onOpenFill: () => void;
  onToggleSel: () => void;
  onRemove: () => void;
  onDeleteFull: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  shareItem: () => void;
}

export default function SpecRow({
  it, selected, accent, dragId, dragOverId, statusMenuId, setStatusMenuId, setStatus,
  onOpen, onOpenFill, onToggleSel, onRemove, onDeleteFull,
  onDragStart, onDragOver, onDrop, onDragEnd, shareItem
}: SpecRowProps) {
  if (it.placeholder) {
    return (
      <div className="spec-row" onClick={onOpenFill} onDragOver={onDragOver} onDrop={onDrop} style={{ display: 'grid', gridTemplateColumns: '38px 46px 58px minmax(150px,1.5fr) 1.1fr 90px 104px 122px 140px 86px', gap: 14, alignItems: 'center', padding: '14px 4px', borderTop: '1px dashed #cfc9bb', cursor: 'pointer', background: 'transparent', opacity: dragId === it.id ? 0.4 : 1, boxShadow: dragOverId === it.id ? `inset 0 2px 0 0 ${accent}` : 'none' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <span className="drag-dots" draggable onDragStart={onDragStart} onDragEnd={onDragEnd} style={{ display: 'grid', gridTemplateColumns: 'repeat(2,2.5px)', gridAutoRows: '2.5px', gap: 2.5, cursor: 'grab' }}>
            {[1, 2, 3, 4, 5, 6].map(i => <span key={i} style={{ width: 2.5, height: 2.5, borderRadius: '50%', background: '#cdc6b6' }}></span>)}
          </span>
          <span onClick={(e) => { e.stopPropagation(); onToggleSel(); }} style={{ width: 16, height: 16, borderRadius: 5, border: `1.5px solid ${selected ? accent : '#c2bdb1'}`, background: selected ? accent : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#f3efe7', fontSize: 11, lineHeight: 1, flex: 'none' }}>{selected ? '✓' : ''}</span>
        </div>
        <div style={{ width: 42, height: 42, borderRadius: 9, border: '1.5px dashed #cdc6b6', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#b3aea2', fontSize: 20, lineHeight: 1 }}>+</div>
        <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 12.5, fontWeight: 500, color: '#a8a296' }}>{it.code}</span>
        <div style={{ minWidth: 0 }}><div style={{ fontSize: 15.5, fontWeight: 500, fontStyle: 'italic', color: '#6a665a' }}>Материал не выбран</div><div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10.5, color: '#6a665a', marginTop: 2, letterSpacing: '.02em' }}>Нажмите, чтобы заполнить</div></div>
        <span style={{ color: '#cdc6b6' }}>—</span>
        <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 13.5, textAlign: 'right', color: '#a8a296' }}>{it.qty} <span style={{ color: '#cdc6b6' }}>{it.unit}</span></span>
        <span style={{ textAlign: 'right', color: '#cdc6b6', fontFamily: "'JetBrains Mono',monospace", fontSize: 13.5 }}>—</span>
        <span style={{ textAlign: 'right', color: '#cdc6b6', fontFamily: "'Space Grotesk',sans-serif", fontSize: 16, fontWeight: 700 }}>—</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#a8a296' }}><span style={{ width: 7, height: 7, borderRadius: '50%', flex: 'none', background: 'transparent', border: '1px dashed #bcb7ab' }}></span>Черновик</span>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 11 }}>
          <span onClick={(e) => { e.stopPropagation(); onDeleteFull(); }} style={{ fontFamily: "'JetBrains Mono',monospace", color: '#c2bdb1', cursor: 'pointer', fontSize: 15, lineHeight: 1 }}>✕</span>
        </div>
      </div>
    );
  }
  return (
    <div className="spec-row" onDragOver={onDragOver} onDrop={onDrop} style={{ display: 'grid', gridTemplateColumns: '38px 46px 58px minmax(150px,1.5fr) 1.1fr 90px 104px 122px 140px 86px', gap: 14, alignItems: 'center', padding: '14px 4px', borderTop: '1px solid #e2ddd1', background: selected ? '#efe9dc' : 'transparent', opacity: dragId === it.id ? 0.4 : 1, boxShadow: dragOverId === it.id ? `inset 0 2px 0 0 ${accent}` : 'none' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        <span className="drag-dots" draggable onDragStart={onDragStart} onDragEnd={onDragEnd} style={{ display: 'grid', gridTemplateColumns: 'repeat(2,2.5px)', gridAutoRows: '2.5px', gap: 2.5, cursor: 'grab' }}>
          {[1, 2, 3, 4, 5, 6].map(i => <span key={i} style={{ width: 2.5, height: 2.5, borderRadius: '50%', background: '#b3aea2' }}></span>)}
        </span>
        <span onClick={(e) => { e.stopPropagation(); onToggleSel(); }} style={{ width: 16, height: 16, borderRadius: 5, border: `1.5px solid ${selected ? accent : '#c2bdb1'}`, background: selected ? accent : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#f3efe7', fontSize: 11, lineHeight: 1, flex: 'none' }}>{selected ? '✓' : ''}</span>
      </div>
      <div onClick={onOpen} style={{ width: 42, height: 42, borderRadius: 9, border: '1px solid #e2ddd1', background: 'repeating-linear-gradient(135deg,#e9e4d9,#e9e4d9 5px,#f0ebe1 5px,#f0ebe1 10px)', cursor: 'pointer' }}></div>
      <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 12.5, fontWeight: 500 }}>{it.code}</span>
      <div onClick={onOpen} style={{ minWidth: 0, cursor: 'pointer' }}>
        <div style={{ fontSize: 16, fontWeight: 600, letterSpacing: '-.01em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.name}</div>
        <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: '#9a958a', marginTop: 2 }}>{it.brand}</div>
      </div>
      <span style={{ fontSize: 14.5, color: '#46423a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.spec}</span>
      <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 13.5, textAlign: 'right' }}>{it.qty} <span style={{ color: '#a8a296' }}>{it.unit}</span></span>
      <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 13.5, textAlign: 'right', color: '#46423a' }}>{fmt(it.price)}</span>
      <span style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 16, fontWeight: 700, textAlign: 'right', letterSpacing: '-.01em' }}>{fmt(it.qty * it.price)} ₽</span>
      <div style={{ position: 'relative' }}>
        <StatusBadge status={it.status} accent={accent} menuOpen={statusMenuId === it.id} onToggleMenu={(e: React.MouseEvent) => { e.stopPropagation(); setStatusMenuId(statusMenuId === it.id ? null : it.id); }} onPick={(s: string) => { setStatus(it.id, s); }} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 11 }}>
        <a href={brandSite(it.brand)} target="_blank" rel="noopener noreferrer" title="Сайт производителя" style={{ color: '#b3aea2', textDecoration: 'none', fontSize: 14, lineHeight: 1, cursor: 'pointer' }}>↗</a>
        <span onClick={shareItem} title="Поделиться" style={{ color: '#b3aea2', cursor: 'pointer', fontSize: 14 }}>🔗</span>
        <span onClick={onRemove} style={{ fontFamily: "'JetBrains Mono',monospace", color: '#c2bdb1', cursor: 'pointer', fontSize: 15, lineHeight: 1 }} title="Удалить">✕</span>
      </div>
    </div>
  );
}