"use client";

import { STATUS_FLOW } from "@/lib/constants";
import { statusMeta } from "@/lib/utils";

interface StatusBadgeProps {
  status: string;
  accent: string;
  menuOpen: boolean;
  onToggleMenu: (e: React.MouseEvent) => void;
  onPick: (s: string) => void;
}

export default function StatusBadge({
  status,
  accent,
  menuOpen,
  onToggleMenu,
  onPick,
}: StatusBadgeProps) {
  const m = statusMeta(status, accent);
  return (
    <>
      <span
        onClick={onToggleMenu}
        className="inline-flex items-center gap-2 py-1 pr-2 pl-3 rounded-full text-[12.5px] font-semibold whitespace-nowrap cursor-pointer"
        style={{ background: m.bg, color: m.fg, border: `1px solid ${m.bd}` }}
      >
        <span className="size-1.5 rounded-full flex-none bg-current opacity-80"></span>
        {status}
        <span className="text-[9px] opacity-60 ml-px">▾</span>
      </span>
      {menuOpen && (
        <div className="absolute top-[calc(100%+6px)] right-0 z-40 min-w-46 bg-bg-card border border-border-muted rounded-[13px] p-[6px] shadow-[0_16px_40px_rgba(27,26,23,.18)]">
          {STATUS_FLOW.map((s) => {
            const sm2 = statusMeta(s, accent);
            return (
              <div
                key={s}
                onClick={() => onPick(s)}
                className="flex items-center gap-2 py-2 px-[10px] rounded-[9px] cursor-pointer text-[13.5px] font-medium text-fg"
              >
                <span
                  className="size-2 rounded-full flex-none"
                  style={{ background: sm2.dot }}
                ></span>
                <span className="flex-1">{s}</span>
                <span className="text-fg text-[12px] w-3 text-right">
                  {s === status ? "✓" : ""}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
