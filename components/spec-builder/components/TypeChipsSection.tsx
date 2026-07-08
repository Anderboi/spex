'use client';

import { TYPE_ORDER } from "@/lib/types";

interface TypeChipsSectionProps {
  activeType: string;
  setActiveType: (t: string) => void;
}

export default function TypeChipsSection({ activeType, setActiveType }: TypeChipsSectionProps) {
  return (
    <div className="flex gap-2 mt-4.5 overflow-x-auto pb-1">
      {['Все типы', ...TYPE_ORDER].map(label => {
        const on = label === activeType;
        return <button key={label} onClick={() => setActiveType(label)} className={`flex-none px-4.5 py-3 rounded-[11px] font-sans text-[14px] font-medium cursor-pointer whitespace-nowrap ${on ? 'bg-bg-accent text-bg border border-bg-accent' : 'bg-bg-card text-fg-body border border-border'}`}>{label}</button>;
      })}
    </div>
  );
}