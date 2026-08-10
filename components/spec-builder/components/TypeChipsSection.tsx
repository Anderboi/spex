// components/ui/type-chips-section.tsx
"use client";

import { useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { TYPE_ORDER } from "@/lib/types";
import { ChevronLeft, ChevronRight } from "lucide-react";

interface TypeChipsSectionProps {
  /** Список типов (по умолчанию берется TYPE_ORDER из @/lib/types) */
  items?: readonly string[];

  /** Название для первого пункта (по умолчанию "Все типы") */
  allLabel?: string;

  /** 1. Controlled mode (через useState) */
  activeType?: string;
  setActiveType?: (type: string) => void;

  /** 2. URL mode (автоматически через URL searchParams, например "type") */
  paramName?: string;

  className?: string;
}

export default function TypeChipsSection({
  items = TYPE_ORDER,
  allLabel = "Все типы",
  activeType: controlledActive,
  setActiveType,
  paramName,
  className = "",
}: TypeChipsSectionProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const allTypes = [allLabel, ...items];

  // Определяем активный тип: приоритет у prop -> затем paramName из URL -> по умолчанию "Все типы"
  let activeType = controlledActive;
  if (paramName) {
    activeType = searchParams.get(paramName) ?? allLabel;
  }
  if (!activeType) {
    activeType = allLabel;
  }

  // Обработчик переключения типа
  const handleSelect = (selectedType: string) => {
    // Если передан внешний сеттер состояния (useState)
    if (setActiveType) {
      setActiveType(selectedType);
    }

    // Если используется фильтрация через URL SearchParams
    if (paramName) {
      const params = new URLSearchParams(searchParams.toString());
      if (selectedType && selectedType !== allLabel) {
        params.set(paramName, selectedType);
      } else {
        params.delete(paramName); // Сбрасываем параметр, если выбрано "Все типы"
      }

      startTransition(() => {
        router.replace(`${pathname}?${params.toString()}`, { scroll: false });
      });
    }
  };

  // Рефы и состояния для Drag-to-Scroll на десктопе
  const scrollRef = useRef<HTMLDivElement>(null);
  const [isMouseDown, setIsMouseDown] = useState(false);
  const [startX, setStartX] = useState(0);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [isDragging, setIsDragging] = useState(false);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!scrollRef.current) return;
    setIsMouseDown(true);
    setIsDragging(false);
    setStartX(e.pageX - scrollRef.current.offsetLeft);
    setScrollLeft(scrollRef.current.scrollLeft);
  };

  const handleMouseLeaveOrUp = () => {
    setIsMouseDown(false);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isMouseDown || !scrollRef.current) return;
    e.preventDefault();
    const x = e.pageX - scrollRef.current.offsetLeft;
    const walk = (x - startX) * 1.5;
    if (Math.abs(walk) > 5) {
      setIsDragging(true);
    }
    scrollRef.current.scrollLeft = scrollLeft - walk;
  };

  const scroll = (direction: "left" | "right") => {
    if (!scrollRef.current) return;
    const offset = direction === "left" ? -200 : 200;
    scrollRef.current.scrollBy({ left: offset, behavior: "smooth" });
  };

  return (
    <div
      className={`mt-4 w-full transition-opacity ${isPending ? "opacity-60" : "opacity-100"} ${className}`}
    >
      {/* 1. МОБИЛЬНАЯ ВЕРСИЯ (< sm): Селект */}
      <div className="block sm:hidden w-full">
        <div className="relative">
          <select
            value={activeType}
            onChange={(e) => handleSelect(e.target.value)}
            className="w-full h-10 rounded-lg bg-bg-card border border-border px-3.5 pr-8 text-sm text-fg-body font-sans appearance-none focus:outline-none focus:ring-1 focus:ring-border cursor-pointer shadow-sm"
          >
            {allTypes.map((label) => (
              <option key={label} value={label} className="bg-bg-card text-fg">
                {label}
              </option>
            ))}
          </select>
          <div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-fg-muted">
            <span className="text-[10px]">▾</span>
          </div>
        </div>
      </div>

      {/* 2. ДЕСКТОП ВЕРСИЯ (>= sm): Чипсы с Drag-to-Scroll */}
      <div className="hidden sm:block relative w-full min-w-0 group">
        <button
          type="button"
          onClick={() => scroll("left")}
          className="absolute left-0 top-1/2 -translate-y-1/2 z-10 size-7 flex items-center justify-center rounded-full bg-bg-card border border-border shadow-md opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer text-fg hover:bg-bg-hover"
        >
          <ChevronLeft className="size-4" />
        </button>

        <div className="[mask-image:linear-gradient(to_right,transparent,black_24px,black_calc(100%-24px),transparent)]">
          <div
            ref={scrollRef}
            onMouseDown={handleMouseDown}
            onMouseLeave={handleMouseLeaveOrUp}
            onMouseUp={handleMouseLeaveOrUp}
            onMouseMove={handleMouseMove}
            className={`flex gap-2 overflow-x-auto whitespace-nowrap py-1 px-6 no-scrollbar [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden select-none ${
              isMouseDown ? "cursor-grabbing" : "cursor-grab"
            }`}
          >
            {allTypes.map((label) => {
              const on = label === activeType;
              return (
                <Button
                  key={label}
                  onClick={(e) => {
                    if (isDragging) {
                      e.preventDefault();
                      return;
                    }
                    handleSelect(label);
                  }}
                  size="sm"
                  className={`shrink-0 rounded-full px-4 font-sans transition-colors cursor-pointer ${
                    on
                      ? "bg-bg-accent text-bg border border-bg-accent hover:bg-bg-accent/90"
                      : "bg-bg-card text-fg-body border border-border hover:text-white hover:bg-bg-hover"
                  }`}
                >
                  {label}
                </Button>
              );
            })}
          </div>
        </div>

        <button
          type="button"
          onClick={() => scroll("right")}
          className="absolute right-0 top-1/2 -translate-y-1/2 z-10 size-7 flex items-center justify-center rounded-full bg-bg-card border border-border shadow-md opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer text-fg hover:bg-bg-hover"
        >
          <ChevronRight className="size-4" />
        </button>
      </div>
    </div>
  );
}
