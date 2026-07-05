'use client';

interface HeaderSectionProps {
  saveStatus: 'idle' | 'saving' | 'saved';
  mobMenuOpen: boolean;
  setMobMenuOpen: (v: boolean) => void;
  setProcureOpen: (v: boolean) => void;
  setSummaryOpen: (v: boolean) => void;
  setAddOpen: () => void;
}

export default function HeaderSection({
  saveStatus, mobMenuOpen, setMobMenuOpen, setProcureOpen, setSummaryOpen, setAddOpen
}: HeaderSectionProps) {
  return (
    <div className="flex items-end justify-between gap-5 flex-wrap pt-[clamp(28px,5vw,48px)]">
      <div className="w-full">
        <div className="font-mono text-[11.5px] tracking-[.1em] uppercase text-fg-muted flex gap-2 items-center">
          <span>Седьмой тестовый проект</span>
          <span className="opacity-50">/</span>
          <span className="text-fg">Спецификации</span>
        </div>
        <div className="flex items-center justify-between gap-3 w-full">
          <h1 className="text-[clamp(34px,6vw,54px)] font-bold tracking-[-.02em] m-0 mt-3 leading-[0.98]">
            Спецификации
          </h1>
        </div>
      </div>
      <div className="flex items-center gap-2 flex-wrap w-full justify-end">
        <div
          role="status"
          aria-live="polite"
          className="flex items-center gap-2 px-1.5 font-mono text-[11.5px] tracking-[.02em] text-fg-secondary whitespace-nowrap"
        >
          {saveStatus === "saving" && (
            <span className="size-2 rounded-full flex-none bg-bg-amber"></span>
          )}
          {saveStatus === "saved" && (
            <span className="size-2 rounded-full flex-none bg-bg-green"></span>
          )}
          <span>{saveStatus === "saving" ? "Сохранение…" : "Сохранено"}</span>
        </div>
        <button
          onClick={() => setProcureOpen(true)}
          className="flex items-center gap-2 bg-bg-card text-fg border border-border-muted rounded-[13px] py-3.5 px-5 font-sans text-[15px] font-semibold cursor-pointer"
        >
          <span className="inline-flex items-center gap-1 text-[16px]">
            <span className="size-2 rounded-full bg-bg-green"></span>
            <span className="size-2 rounded-full bg-[#3f6b80]"></span>
          </span>
          &nbsp;Закупка
        </button>
        <button
          onClick={() => setSummaryOpen(true)}
          className="flex items-center gap-2 bg-bg-card text-fg border border-border-muted rounded-[13px] py-3.5 px-5 font-sans text-[15px] font-semibold cursor-pointer"
        >
          <span className="inline-flex flex-col gap-[2.5px] w-3 text-[16px]">
            <span className="h-[1.7px] bg-current rounded-sm"></span>
            <span className="h-[1.7px] w-2 bg-current rounded-sm"></span>
            <span className="h-[1.7px] bg-current rounded-sm"></span>
          </span>
          Экспорт
        </button>
        <button
          onClick={setAddOpen}
          className="flex items-center gap-[10px] bg-bg-accent text-bg border-none rounded-[13px] py-[15px] px-[22px] font-sans text-[15px] font-semibold cursor-pointer"
        >
          <span className="text-[18px] leading-none -mt-[2px]">+</span> Добавить
          материал
        </button>
      </div>
    </div>
  );
}