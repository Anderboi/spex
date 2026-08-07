'use client';

import { SpecItem } from "@/lib/types";
import { fmt, brandSite } from "@/lib/utils";
import StatusBadge from './StatusBadge';
import { Link, X } from 'lucide-react';

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
      <div className="spec-row grid grid-cols-[38px_46px_58px_minmax(150px,1.5fr)_1.1fr_90px_104px_122px_140px_86px] gap-3.5 items-center py-3.5 px-1 border-t border-dashed border-fg-dash cursor-pointer bg-transparent" onClick={onOpenFill} onDragOver={onDragOver} onDrop={onDrop} style={{ opacity: dragId === it.id ? 0.4 : 1, boxShadow: dragOverId === it.id ? `inset 0 2px 0 0 ${accent}` : 'none' }}>
        <div className="flex items-center gap-2">
          <span className="drag-dots grid grid-cols-[repeat(2,2.5px)] gap-[2.5px] auto-rows-[2.5px] cursor-grab" draggable onDragStart={onDragStart} onDragEnd={onDragEnd}>
            {[1, 2, 3, 4, 5, 6].map(i => <span key={i} className="w-[2.5px] h-[2.5px] rounded-full bg-fg-dots"></span>)}
          </span>
          <span onClick={(e) => { e.stopPropagation(); onToggleSel(); }} className="w-4 h-4 rounded-[5px] flex items-center justify-center cursor-pointer text-bg text-[11px] leading-none flex-none" style={{ border: `1.5px solid ${selected ? accent : '#c2bdb1'}`, background: selected ? accent : 'transparent', color: '#f3efe7' }}>{selected ? '✓' : ''}</span>
        </div>
        <div className="size-10 rounded-[9px] border-[1.5px] border-dashed border-fg-dash-dots flex items-center justify-center text-fg-icon text-[20px] leading-none">+</div>
        <span className="font-mono text-[12.5px] font-medium text-fg-dim">{it.code}</span>
        <div className="min-w-0">
          <div className="text-[15.5px] font-medium italic text-fg-secondary">Материал не выбран</div>
          <div className="font-mono text-[10.5px] text-fg-secondary mt-0.5 tracking-[.02em]">Нажмите, чтобы заполнить</div>
        </div>
        <span className="text-fg-dots">—</span>
        <span className="font-mono text-[13.5px] text-right text-fg-dim">{it.qty} <span className="text-fg-dots">{it.unit}</span></span>
        <span className="text-right text-fg-dots font-mono text-[13.5px]">—</span>
        <span className="text-right text-fg-dots font-sans text-[16px] font-bold">—</span>
        <span className="flex items-center gap-2 text-[13px] text-fg-dim"><span className="size-2 rounded-full flex-none bg-transparent border border-dashed border-fg-dash"></span>Черновик</span>
        <div className="flex items-center justify-end gap-3">
          <span onClick={(e) => { e.stopPropagation(); onDeleteFull(); }} className="font-mono text-fg-delete cursor-pointer text-[15px] leading-none">✕</span>
        </div>
      </div>
    );
  }
  return (
    <div
      className="spec-row grid grid-cols-[38px_46px_58px_minmax(150px,1.5fr)_1.1fr_90px_104px_122px_140px_86px] gap-3.5 items-center py-3.5 px-1 border-t border-border-subtle"
      onDragOver={onDragOver}
      onDrop={onDrop}
      style={{
        background: selected ? "#efe9dc" : "transparent",
        opacity: dragId === it.id ? 0.4 : 1,
        boxShadow: dragOverId === it.id ? `inset 0 2px 0 0 ${accent}` : "none",
      }}
    >
      <div className="flex items-center gap-2">
        <span
          className="drag-dots grid grid-cols-[repeat(2,2.5px)] gap-[2.5px] auto-rows-[2.5px] cursor-grab"
          draggable
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
        >
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <span
              key={i}
              className="w-[2.5px] h-[2.5px] rounded-full bg-fg-icon"
            ></span>
          ))}
        </span>
        <span
          onClick={(e) => {
            e.stopPropagation();
            onToggleSel();
          }}
          className="w-4 h-4 rounded-[5px] flex items-center justify-center cursor-pointer text-bg text-[11px] leading-none flex-none"
          style={{
            border: `1.5px solid ${selected ? accent : "#c2bdb1"}`,
            background: selected ? accent : "transparent",
          }}
        >
          {selected ? "✓" : ""}
        </span>
      </div>
      <div
        onClick={onOpen}
        className="size-10 rounded-[9px] border border-border-placeholder cursor-pointer [background:repeating-linear-gradient(135deg,#e9e4d9,#e9e4d9_5px,#f0ebe1_5px,#f0ebe1_10px)]"
      ></div>
      <span className="font-mono text-[12.5px] font-medium text-fg">
        {it.code}
      </span>
      <div onClick={onOpen} className="min-w-0 cursor-pointer">
        <div className="text-[16px] font-semibold tracking-[-.01em] truncate">
          {it.name}
        </div>
        <div className="font-mono text-[11px] text-fg-muted mt-0.5">
          {it.brand}
        </div>
      </div>
      <span className="text-[14.5px] text-fg-body truncate">{it.spec}</span>
      <span className="font-mono text-[13.5px] text-right">
        {it.qty} <span className="text-fg-dim">{it.unit}</span>
      </span>
      <span className="font-mono text-[13.5px] text-right text-fg-body">
        {fmt(it.price)}
      </span>
      <span className="font-sans text-[16px] font-bold text-right tracking-[-.01em]">
        {fmt(it.qty * it.price)} ₽
      </span>
      <div className="relative">
        <StatusBadge
          status={it.status}
          accent={accent}
          menuOpen={statusMenuId === it.id}
          onToggleMenu={(e: React.MouseEvent) => {
            e.stopPropagation();
            setStatusMenuId(statusMenuId === it.id ? null : it.id);
          }}
          onPick={(s: string) => {
            setStatus(it.id, s);
          }}
        />
      </div>
      <div className="flex items-center justify-end gap-3">
        <a
          href={brandSite(it.brand)}
          target="_blank"
          rel="noopener noreferrer"
          title="Сайт производителя"
          className="text-fg-icon no-underline text-[14px] leading-none cursor-pointer"
        >
          ↗
        </a>
        <span
          onClick={shareItem}
          title="Поделиться"
          className="text-fg-icon cursor-pointer text-[14px]"
        >
          <Link size="14" />
        </span>
        <span
          onClick={onRemove}
          className="font-mono text-fg-delete cursor-pointer text-[15px] leading-none"
          title="Удалить"
        >
          <X size="14" />
        </span>
      </div>
    </div>
  );
}