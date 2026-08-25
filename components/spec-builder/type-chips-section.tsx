"use client";

import { useCallback, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { TYPE_ORDER } from "@/lib/constants";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

interface TypeChipsSectionProps {
  items?: readonly string[];
  className?: string;
}

export default function TypeChipsSection({
  items = TYPE_ORDER,

  className = "",
}: TypeChipsSectionProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const allTypes = ["Все типы", ...items];
  const activeCategory = searchParams.get("category") || "Все типы";

  const handleSelectCategory = useCallback(
    (category: string) => {
      const params = new URLSearchParams(searchParams.toString());

      if (category === "Все типы" || !category) {
        params.delete("category");
      } else {
        params.set("category", category);
      }

      // Сбрасываем страницу пагинации при смене категории, если она есть
      params.delete("page");

      const query = params.toString();
      const url = query ? `${pathname}?${query}` : pathname;
      startTransition(() => {
        router.replace(url, { scroll: false });
      });
    },
    [searchParams, pathname, router],
  );

  // Рефы и состояния для Drag-to-Scroll на десктопе
  const scrollRef = useRef<HTMLDivElement>(null);
  const dragInfo = useRef({
    isMouseDown: false,
    startX: 0,
    scrollLeft: 0,
    isDragging: false,
  });
  const [isMouseDown, setIsMouseDown] = useState(false);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!scrollRef.current) return;
    dragInfo.current = {
      isMouseDown: true,
      startX: e.pageX - scrollRef.current.offsetLeft,
      scrollLeft: scrollRef.current.scrollLeft,
      isDragging: false, // ✅ Сбрасываем флаг при новом нажатии
    };
  };

  const handleMouseLeaveOrUp = () => {
    dragInfo.current.isMouseDown = false;
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const { isMouseDown, startX, scrollLeft } = dragInfo.current;
    if (!isMouseDown || !scrollRef.current) return;

    const x = e.pageX - scrollRef.current.offsetLeft;
    const walk = (x - startX) * 1.5;

    // Если сдвиг больше 5px — считаем это драгом (а не кликом)
    if (Math.abs(walk) > 5) {
      dragInfo.current.isDragging = true;
    }

    // Изменяем скролл напрямую в DOM без вызова setState
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
            value={activeCategory}
            onChange={(e) => handleSelectCategory(e.target.value)}
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
            className={`flex gap-2 overflow-x-auto whitespace-nowrap py-1 px-6 no-scrollbar scrollbar-none [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden select-none ${
              isMouseDown ? "cursor-grabbing" : "cursor-grab"
            }`}
          >
            {allTypes.map((label) => {
              const on = label === activeCategory;
              return (
                <Button
                  key={label}
                  onClick={(e) => {
                    if (dragInfo.current.isDragging) {
                      e.preventDefault();
                      return;
                    }
                    handleSelectCategory(label);
                  }}
                  size="sm"
                  className={`shrink-0 rounded-full px-4 text-sm font-sans transition-colors cursor-pointer ${
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
