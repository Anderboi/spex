'use client';

import { STATUS_FLOW } from '@/lib/types';
import { statusMeta } from "@/lib/utils";
import { useSidebar } from "@/components/ui/sidebar";

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
  const { state, isMobile } = useSidebar();
  const isCollapsed = state === "collapsed" || isMobile;

  return (
    <div
      style={{
        left: isCollapsed ? "0px" : "var(--sidebar-width, 0px)",
      }}
      className="fixed left-0 right-0 bottom-0  transition-all duration-200 ease-in-out z-40 flex justify-center px-[clamp(16px,4vw,48px)] pb-[clamp(16px,3vw,28px)] pointer-events-none"
    >
      <div className="w-full max-w-295 flex items-center justify-between gap-4 bg-bg-accent text-bg rounded-[16px] py-4 px-[clamp(18px,3vw,30px)] pointer-events-auto shadow-[0_18px_50px_rgba(27,26,23,.28)]">
        {!selectionActive ? (
          <div className="flex items-center justify-between gap-4 w-full">
            <div className="flex items-baseline gap-3">
              <span className="font-mono text-[10.5px] tracking-[.12em] uppercase text-[#8d887d]">
                Позиций
              </span>
              <span className="text-[clamp(20px,4vw,26px)] font-mono font-bold">
                {totalCount}
              </span>
            </div>
            <div className="flex items-baseline gap-3">
              <span className="font-mono text-[10.5px] tracking-[.12em] uppercase text-[#8d887d]">
                Сумма
              </span>
              <span className="text-[clamp(22px,5vw,30px)] font-mono font-bold tracking-[-.01em]">
                {totalSum} ₽
              </span>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-3 w-full flex-wrap">
            <div className="flex items-baseline gap-3">
              <span className="text-[clamp(19px,3.5vw,24px)] font-mono font-bold">
                {selCount}
              </span>
              <span className="font-mono text-[10.5px] tracking-widest uppercase text-[#8d887d]">
                выбрано · {selSumStr} ₽
              </span>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <span
                onClick={onSelectAllVisible}
                className="bg-transparent border border-[rgba(243,239,231,.28)] text-bg rounded-md py-2 px-3 font-sans text-[13px] font-semibold cursor-pointer"
              >
                {allVisibleSelected ? "Снять все" : "Выбрать все"}
              </span>
              <div className="relative">
                <span
                  onClick={() => setBulkMenuOpen(!bulkMenuOpen)}
                  className="flex items-center gap-2 bg-transparent border border-[rgba(243,239,231,.28)] text-bg rounded-md py-2 px-3 font-sans text-[13px] font-semibold cursor-pointer whitespace-nowrap"
                >
                  Статус <span className="text-[9px] opacity-70">▾</span>
                </span>
                {bulkMenuOpen && (
                  <div className="absolute bottom-[calc(100%+9px)] left-0 z-60 min-w-48 bg-bg-card border border-border-muted rounded-lg p-1 shadow-[0_18px_44px_rgba(27,26,23,.3)]">
                    <div className="font-mono text-[9px] tracking-widest uppercase text-fg-muted py-1 px-2 pb-1">
                      Назначить статус
                    </div>
                    {STATUS_FLOW.map((s) => (
                      <div
                        key={s}
                        onClick={() => {
                          bulkStatus(s);
                          setBulkMenuOpen(false);
                        }}
                        className="flex items-center gap-2 py-2 px-2 rounded-md cursor-pointer text-fg text-[13.5px] font-medium"
                      >
                        <span
                          className="w-2 h-2 rounded-full flex-none"
                          style={{ background: statusMeta(s, "#1b1a17").dot }}
                        ></span>
                        {s}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <span
                onClick={onBulkDelete}
                className="bg-transparent border border-[rgba(231,160,150,.5)] text-fg-red-light rounded-md py-2 px-3 font-sans text-[13px] font-semibold cursor-pointer whitespace-nowrap"
              >
                Удалить {selCount}
              </span>
              <span
                onClick={onClearSel}
                className="flex items-center justify-center size-8 rounded-md border border-[rgba(243,239,231,.28)] text-bg cursor-pointer text-[15px]"
              >
                ✕
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}