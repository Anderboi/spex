"use client";

import { useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TYPE_ORDER } from "@/lib/constants";
import { useSearchParams } from "next/navigation";
import { useMaterialsUrl } from "../../hooks/use-materials-url";
import { cn } from "@/lib/utils";

const ALL_LABEL = "Все типы";

export function MaterialsCategoryFilter({ className }: { className?: string }) {
  const searchParams = useSearchParams();
  const { update, isPending } = useMaterialsUrl();

  const activeCategory = searchParams.get("category") ?? null;

  const select = (category: string | null) => update({ category });

  const options: { label: string; value: string | null }[] = [
    { label: ALL_LABEL, value: null },
    ...TYPE_ORDER.map((t) => ({ label: t, value: t })),
  ];

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
      isDragging: false,
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

    if (Math.abs(walk) > 5) dragInfo.current.isDragging = true;
    scrollRef.current.scrollLeft = scrollLeft - walk;
  };

  const scroll = (direction: "left" | "right") => {
    if (!scrollRef.current) return;
    const offset = direction === "left" ? -200 : 200;
    scrollRef.current.scrollBy({ left: offset, behavior: "smooth" });
  };

  return (
    <div
      className={cn(
        "w-full transition-opacity",
        isPending && "opacity-60",
        className,
      )}
    >
      {/* Мобильная версия: селект */}
      <div className="block w-full sm:hidden">
        <select
          value={activeCategory ?? ""}
          onChange={(e) => select(e.target.value || null)}
          aria-label="Категория"
          className="h-10 w-full cursor-pointer appearance-none rounded-lg border border-border bg-bg-card px-3.5 pr-8 text-sm text-fg shadow-sm outline-none focus:ring-1 focus:ring-border"
        >
          {options.map((o) => (
            <option key={o.label} value={o.value ?? ""}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      {/* Десктоп: чипсы с drag-to-scroll */}
      <div className="group relative hidden w-full min-w-0 sm:block">
        <button
          type="button"
          onClick={() => scroll("left")}
          className="absolute left-0 top-1/2 z-10 flex size-7 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border border-border bg-bg-card text-fg opacity-0 shadow-md transition-opacity hover:bg-bg-hover group-hover:opacity-100"
        >
          <ChevronLeft className="size-4" />
        </button>

        <div className="mask-[linear-gradient(to_right,transparent,black_24px,black_calc(100%-24px),transparent)]">
          <div
            ref={scrollRef}
            onMouseDown={handleMouseDown}
            onMouseLeave={handleMouseLeaveOrUp}
            onMouseUp={handleMouseLeaveOrUp}
            onMouseMove={handleMouseMove}
            className={cn(
              "flex select-none gap-2 overflow-x-auto whitespace-nowrap px-6 py-1 no-scrollbar scrollbar-none [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden",
              isMouseDown ? "cursor-grabbing" : "cursor-grab",
            )}
          >
            {options.map((o) => {
              const on = (o.value ?? null) === activeCategory;
              return (
                <Button
                  key={o.label}
                  onClick={(e) => {
                    if (dragInfo.current.isDragging) {
                      e.preventDefault();
                      return;
                    }
                    select(o.value);
                  }}
                  size="sm"
                  className={cn(
                    "shrink-0 cursor-pointer rounded-full px-4 text-sm font-sans transition-colors",
                    on
                      ? "border border-bg-accent bg-bg-accent text-bg hover:bg-bg-accent/90"
                      : "border border-border bg-bg-card text-fg-body hover:bg-bg-hover hover:text-white",
                  )}
                >
                  {o.label}
                </Button>
              );
            })}
          </div>
        </div>

        <button
          type="button"
          onClick={() => scroll("right")}
          className="absolute right-0 top-1/2 z-10 flex size-7 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border border-border bg-bg-card text-fg opacity-0 shadow-md transition-opacity hover:bg-bg-hover group-hover:opacity-100"
        >
          <ChevronRight className="size-4" />
        </button>
      </div>
    </div>
  );
}
