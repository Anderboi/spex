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
    <div className="mt-[30px]">
      <div onClick={() => setCollapsed({ ...collapsed, [group.type]: !collapsed[group.type] })} className="flex items-center justify-between px-1 pb-[14px] border-b border-fg cursor-pointer">
        <div className="flex items-center gap-3">
          <span className="text-fg-muted text-[11px] inline-block transition-transform duration-200" style={{ transform: group.caret }}>▾</span>
          <span className="font-mono text-[13px] tracking-[.12em] uppercase font-semibold">{group.type}</span>
          <span className="font-mono text-[11px] text-fg-muted border border-border-muted rounded-full px-2 py-[2px]">{group.count}</span>
        </div>
        <span className="font-mono text-[13.5px] font-semibold tracking-[.02em]">{group.sumStr} ₽</span>
      </div>

      {group.showTable && group.open && (
        <>
          <div className="grid grid-cols-[38px_46px_58px_minmax(150px,1.5fr)_1.1fr_90px_104px_122px_140px_86px] gap-3.5 py-3 px-1 pb-2 font-mono text-[9.5px] tracking-[.1em] uppercase text-fg-dim">
            <span></span><span></span><span>Код</span><span>Наименование</span><span>Спецификация</span><span className="text-right">Кол-во</span><span className="text-right">Цена/шт</span><span className="text-right">Итого</span><span>Статус</span><span></span>
          </div>
          {group.items.map((it: SpecItem) => (
            <SpecRow key={it.id} it={it} selected={!!selected[it.id]} accent={accent} dragId={dragId} dragOverId={dragOverId} statusMenuId={statusMenuId} setStatusMenuId={setStatusMenuId} setStatus={setStatus} onOpen={() => onOpen(it.id)} onOpenFill={() => onOpenFill(it)} onToggleSel={() => onToggleSel(it.id)} onRemove={() => onRemove(it.id)} onDeleteFull={() => onDeleteFull(it.id)} onDragStart={(e: React.DragEvent) => onDragStart(it.id, e)} onDragOver={(e: React.DragEvent) => onDragOver(it.id, e)} onDrop={(e: React.DragEvent) => onDrop(e)} onDragEnd={onDragEnd} shareItem={() => shareItem(it)} />
          ))}
          <div onClick={() => onAddPlaceholder(group.type)} className="flex items-center gap-[11px] py-3 px-1 border-t border-dashed border-fg-dash text-fg-muted cursor-pointer font-sans text-[14px] font-semibold">
            <span className="w-6 h-6 rounded-[7px] border-[1.5px] border-dashed border-fg-dash-dots flex items-center justify-center text-[16px] leading-none">+</span> Добавить позицию
          </div>
        </>
      )}

      {group.showCards && group.open && group.items.map((it: SpecItem) => (
        it.placeholder ? (
          <div key={it.id} onClick={() => onOpenFill(it)} className="bg-transparent border-[1.5px] border-dashed border-fg-dash rounded-[16px] p-[15px] mt-[10px] cursor-pointer flex items-center gap-[13px]">
            <div className="w-[50px] h-[50px] rounded-[9px] border-[1.5px] border-dashed border-fg-dash-dots flex items-center justify-center text-fg-icon text-[24px] leading-none flex-none">+</div>
            <div className="flex-1 min-w-0"><div className="text-[16px] font-medium italic text-fg-secondary">Материал не выбран</div><div className="font-mono text-[10px] text-fg-secondary mt-[3px]">{it.code} · нажмите, чтобы заполнить</div></div>
            <span onClick={(e) => { e.stopPropagation(); onDeleteFull(it.id); }} className="font-mono text-fg-delete cursor-pointer text-[16px] leading-none p-1">✕</span>
          </div>
        ) : (
          <div key={it.id} className="bg-bg-card border border-border rounded-[16px] p-[14px] mt-[10px]">
            <div className="flex gap-3">
              <div onClick={() => onOpen(it.id)} className="w-[54px] h-[54px] rounded-[9px] border border-border-placeholder flex-none cursor-pointer [background:repeating-linear-gradient(135deg,#e9e4d9,#e9e4d9_5px,#f0ebe1_5px,#f0ebe1_10px)]"></div>
              <div onClick={() => onOpen(it.id)} className="flex-1 min-w-0 cursor-pointer">
                <div className="text-[17px] font-semibold tracking-[-.01em] leading-[1.05] truncate">{it.name}</div>
                <div className="font-mono text-[10px] text-fg-muted mt-[3px] tracking-[.04em]">{it.code} · {it.brand}</div>
                <div className="text-[14px] text-fg-body mt-[6px] truncate">{it.spec}</div>
              </div>
              <div className="flex items-center gap-[2px] flex-none">
                <a href={brandSite(it.brand)} target="_blank" rel="noopener noreferrer" className="flex items-center justify-center w-[34px] h-[34px] rounded-[9px] text-fg-muted no-underline text-[16px]">↗</a>
                <span onClick={() => shareItem(it)} className="flex items-center justify-center w-[34px] h-[34px] rounded-[9px] text-fg-muted cursor-pointer">🔗</span>
                <span onClick={() => onRemove(it.id)} className="flex items-center justify-center w-[34px] h-[34px] rounded-[9px] text-fg-icon cursor-pointer text-[16px]">✕</span>
              </div>
            </div>
            <div className="flex items-center justify-between mt-3 pt-[11px] border-t border-[#ece6da]">
              <div className="relative">
                <StatusBadge status={it.status} accent={accent} menuOpen={statusMenuId === it.id} onToggleMenu={(e: React.MouseEvent) => { e.stopPropagation(); setStatusMenuId(statusMenuId === it.id ? null : it.id); }} onPick={(s: string) => { setStatus(it.id, s); }} />
              </div>
              <div className="flex items-baseline gap-3">
                <span className="font-mono text-[11.5px] text-fg-muted">{it.qty} {it.unit} × {fmt(it.price)}</span>
                <span className="font-sans text-[18px] font-bold tracking-[-.01em]">{fmt(it.qty * it.price)} ₽</span>
              </div>
            </div>
          </div>
        )
      ))}
      {group.showCards && group.open && (
        <div onClick={() => onAddPlaceholder(group.type)} className="flex items-center gap-[11px] p-[15px] mt-[10px] border-[1.5px] border-dashed border-fg-dash rounded-[16px] text-fg-muted cursor-pointer font-sans text-[14px] font-semibold">
          <span className="w-[26px] h-[26px] rounded-[7px] border-[1.5px] border-dashed border-fg-dash-dots flex items-center justify-center text-[17px] leading-none">+</span> Добавить позицию
        </div>
      )}
    </div>
  );
}