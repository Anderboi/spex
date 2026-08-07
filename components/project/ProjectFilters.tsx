"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

export function ProjectFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const query = searchParams.get("q") ?? "";
  const sortBy = searchParams.get("sort") ?? "date";

  const updateSearch = (term: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (term.trim()) {
      params.set("q", term);
    } else {
      params.delete("q");
    }

    startTransition(() => {
      router.replace(`${pathname}?${params.toString()}`);
    });
  };

  const updateSort = (sortKey: "date" | "name" | "budget") => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("sort", sortKey);

    startTransition(() => {
      router.replace(`${pathname}?${params.toString()}`);
    });
  };

  return (
    <div
      className={`flex items-center gap-3 mt-9 flex-wrap transition-opacity ${isPending ? "opacity-60" : "opacity-100"}`}
    >
      {/* Search Input */}
      <div className="relative flex-1 min-w-55 max-w-105">
        <svg
          className="absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none text-fg-muted"
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
        >
          <circle
            cx="7"
            cy="7"
            r="5.5"
            stroke="currentColor"
            strokeWidth="1.4"
          />
          <line
            x1="10.8"
            y1="10.8"
            x2="14.5"
            y2="14.5"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
        </svg>
        <input
          type="text"
          placeholder="Поиск по проектам…"
          defaultValue={query}
          onChange={(e) => updateSearch(e.target.value)}
          className="w-full bg-bg-card border border-border-muted rounded-[12px] py-3.5 pl-11 pr-4 font-sans text-[15px] text-fg placeholder:text-fg-muted outline-none focus:border-border-dash-input transition-colors"
        />
        {query && (
          <button
            onClick={() => updateSearch("")}
            className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-fg-muted text-bg-card text-[12px] leading-none flex items-center justify-center border-none cursor-pointer"
            aria-label="Очистить"
          >
            ✕
          </button>
        )}
      </div>

      {/* Sort Buttons */}
      <div className="flex items-center gap-2">
        <span className="text-[13px] text-fg-muted font-mono tracking-[.04em] uppercase">
          Сорт.
        </span>
        {(["date", "name", "budget"] as const).map((key) => (
          <button
            key={key}
            onClick={() => updateSort(key)}
            className={`rounded-[10px] py-2 px-3.5 font-sans text-[13.5px] font-semibold cursor-pointer border transition-colors ${
              sortBy === key
                ? "bg-bg-accent text-bg border-bg-accent"
                : "bg-transparent text-fg-secondary border-border-muted hover:bg-bg-toggle"
            }`}
          >
            {key === "date" ? "Дата" : key === "name" ? "Название" : "Бюджет"}
          </button>
        ))}
      </div>
    </div>
  );
}
