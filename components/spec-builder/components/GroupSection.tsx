'use client';

import { SpecItem } from '../types';
import { fmt, brandSite } from '../utils';
import SpecRow from './SpecRow';
import StatusBadge from './StatusBadge';

interface GroupData {
  type: string;
  count: number;
  sumStr: string;
  caret: string;
  open: boolean;
  showTable: boolean;
  showCards: boolean;
  items: SpecItem[];
}

interface GroupSectionProps {
  group: GroupData;
  collapsed: Record<string, boolean>;
  setCollapsed: (v: Record<string, boolean>) => void;
  selected: Record<string, boolean>;
  accent: string;
  dragId: string | null;
  dragOverId: string | null;
  statusMenuId: string | null;
  setStatusMenuId: (id: string | null) => void;
  setStatus: (id: string, s: string) => void;
  onOpen: (id: string) => void;
  onOpenFill: (it: SpecItem) => void;
  onToggleSel: (id: string) => void;
  onRemove: (id: string) => void;
  onDeleteFull: (id: string) => void;
  onDragStart: (id: string, e: React.DragEvent) => void;
  onDragOver: (id: string, e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  onAddPlaceholder: (type: string) => void;
  shareItem: (it: SpecItem) => void;
}

export default function GroupSection({
  group, collapsed, setCollapsed, selected, accent, dragId, dragOverId,
  statusMenuId, setStatusMenuId, setStatus, onOpen, onOpenFill, onToggleSel,
  onRemove, onDeleteFull, onDragStart, onDragOver, onDrop, onDragEnd,
  onAddPlaceholder, shareItem
}: GroupSectionProps) {
  return (
    <div style={{ marginTop: 30 }}>
      <div onClick={() => setCollapsed({ ...collapsed, [group.type]: !collapsed[group.type] })} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 4px 14px 4px', borderBottom: '1px solid #1b1a17', cursor: 'pointer' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 13 }}>
          <span style={{ color: '#9a958a', fontSize: 11, display: 'inline-block', transition: 'transform .2s', transform: group.caret }}>▾</span>
          <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 13, letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 600 }}>{group.type}</span>
          <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: '#9a958a', border: '1px solid #d9d3c6', borderRadius: 20, padding: '2px 9px' }}>{group.count}</span>
        </div>
        <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 13.5, fontWeight: 600, letterSpacing: '.02em' }}>{group.sumStr} ₽</span>
      </div>

      {group.showTable && group.open && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '38px 46px 58px minmax(150px,1.5fr) 1.1fr 90px 104px 122px 140px 86px', gap: 14, padding: '11px 4px 9px 4px', fontFamily: "'JetBrains Mono',monospace", fontSize: 9.5, letterSpacing: '.1em', textTransform: 'uppercase', color: '#a8a296' }}>
            <span></span><span></span><span>Код</span><span>Наименование</span><span>Спецификация</span><span style={{ textAlign: 'right' }}>Кол-во</span><span style={{ textAlign: 'right' }}>Цена/шт</span><span style={{ textAlign: 'right' }}>Итого</span><span>Статус</span><span></span>
          </div>
          {group.items.map((it: SpecItem) => (
            <SpecRow key={it.id} it={it} selected={!!selected[it.id]} accent={accent} dragId={dragId} dragOverId={dragOverId} statusMenuId={statusMenuId} setStatusMenuId={setStatusMenuId} setStatus={setStatus} onOpen={() => onOpen(it.id)} onOpenFill={() => onOpenFill(it)} onToggleSel={() => onToggleSel(it.id)} onRemove={() => onRemove(it.id)} onDeleteFull={() => onDeleteFull(it.id)} onDragStart={(e: React.DragEvent) => onDragStart(it.id, e)} onDragOver={(e: React.DragEvent) => onDragOver(it.id, e)} onDrop={(e: React.DragEvent) => onDrop(e)} onDragEnd={onDragEnd} shareItem={() => shareItem(it)} />
          ))}
          <div onClick={() => onAddPlaceholder(group.type)} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '13px 4px', borderTop: '1px dashed #cfc9bb', color: '#9a958a', cursor: 'pointer', fontFamily: "'Space Grotesk',sans-serif", fontSize: 14, fontWeight: 600 }}>
            <span style={{ width: 24, height: 24, borderRadius: 7, border: '1.5px dashed #cdc6b6', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, lineHeight: 1 }}>+</span> Добавить позицию
          </div>
        </>
      )}

      {group.showCards && group.open && group.items.map((it: SpecItem) => (
        it.placeholder ? (
          <div key={it.id} onClick={() => onOpenFill(it)} style={{ background: 'transparent', border: '1.5px dashed #cfc9bb', borderRadius: 16, padding: 15, marginTop: 10, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 13 }}>
            <div style={{ width: 50, height: 50, borderRadius: 9, border: '1.5px dashed #cdc6b6', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#b3aea2', fontSize: 24, lineHeight: 1, flex: 'none' }}>+</div>
            <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 16, fontWeight: 500, fontStyle: 'italic', color: '#6a665a' }}>Материал не выбран</div><div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10, color: '#6a665a', marginTop: 3 }}>{it.code} · нажмите, чтобы заполнить</div></div>
            <span onClick={(e) => { e.stopPropagation(); onDeleteFull(it.id); }} style={{ fontFamily: "'JetBrains Mono',monospace", color: '#c2bdb1', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: 4 }}>✕</span>
          </div>
        ) : (
          <div key={it.id} style={{ background: '#faf8f3', border: '1px solid #e6e1d5', borderRadius: 16, padding: 14, marginTop: 10 }}>
            <div style={{ display: 'flex', gap: 12 }}>
              <div onClick={() => onOpen(it.id)} style={{ width: 54, height: 54, borderRadius: 9, border: '1px solid #e2ddd1', background: 'repeating-linear-gradient(135deg,#e9e4d9,#e9e4d9 5px,#f0ebe1 5px,#f0ebe1 10px)', flex: 'none', cursor: 'pointer' }}></div>
              <div onClick={() => onOpen(it.id)} style={{ flex: 1, minWidth: 0, cursor: 'pointer' }}>
                <div style={{ fontSize: 17, fontWeight: 600, letterSpacing: '-.01em', lineHeight: 1.05, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.name}</div>
                <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10, color: '#9a958a', marginTop: 3, letterSpacing: '.04em' }}>{it.code} · {it.brand}</div>
                <div style={{ fontSize: 14, color: '#46423a', marginTop: 6, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.spec}</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 2, flex: 'none' }}>
                <a href={brandSite(it.brand)} target="_blank" rel="noopener noreferrer" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 34, height: 34, borderRadius: 9, color: '#9a958a', textDecoration: 'none', fontSize: 16 }}>↗</a>
                <span onClick={() => shareItem(it)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 34, height: 34, borderRadius: 9, color: '#9a958a', cursor: 'pointer' }}>🔗</span>
                <span onClick={() => onRemove(it.id)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 34, height: 34, borderRadius: 9, color: '#b3aea2', cursor: 'pointer', fontSize: 16 }}>✕</span>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 12, paddingTop: 11, borderTop: '1px solid #ece6da' }}>
              <div style={{ position: 'relative' }}>
                <StatusBadge status={it.status} accent={accent} menuOpen={statusMenuId === it.id} onToggleMenu={(e: React.MouseEvent) => { e.stopPropagation(); setStatusMenuId(statusMenuId === it.id ? null : it.id); }} onPick={(s: string) => { setStatus(it.id, s); }} />
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
                <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11.5, color: '#9a958a' }}>{it.qty} {it.unit} × {fmt(it.price)}</span>
                <span style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 18, fontWeight: 700, letterSpacing: '-.01em' }}>{fmt(it.qty * it.price)} ₽</span>
              </div>
            </div>
          </div>
        )
      ))}
      {group.showCards && group.open && (
        <div onClick={() => onAddPlaceholder(group.type)} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: 15, marginTop: 10, border: '1.5px dashed #cfc9bb', borderRadius: 16, color: '#9a958a', cursor: 'pointer', fontFamily: "'Space Grotesk',sans-serif", fontSize: 14, fontWeight: 600 }}>
          <span style={{ width: 26, height: 26, borderRadius: 7, border: '1.5px dashed #cdc6b6', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17, lineHeight: 1 }}>+</span> Добавить позицию
        </div>
      )}
    </div>
  );
}