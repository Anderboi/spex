"use client";

import { useState, useMemo } from "react";
import { fmtRub, plural } from "@/lib/utils";
import { MOCK_PROJECTS } from "@/lib/constants";
import { ProjectCard } from "@/components/project/ProjectCard";

function EmptyState({ onNew }: { onNew: () => void }) {
  return (
    <div className="text-center py-28 px-5">
      <div className="inline-flex items-center justify-center size-24 rounded-full bg-bg-select mb-6">
        <svg
          width="40"
          height="40"
          viewBox="0 0 40 40"
          fill="none"
          className="text-fg-muted"
        >
          <rect
            x="4"
            y="6"
            width="32"
            height="28"
            rx="3"
            stroke="currentColor"
            strokeWidth="1.8"
          />
          <line
            x1="14"
            y1="16"
            x2="26"
            y2="16"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
          <line
            x1="14"
            y1="21"
            x2="22"
            y2="21"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
          <line
            x1="14"
            y1="26"
            x2="24"
            y2="26"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
        </svg>
      </div>
      <div className="text-[22px] font-semibold text-fg">Нет проектов</div>
      <div className="text-[15px] text-fg-muted mt-2 mb-6">
        Создайте ваш первый дизайн-проект и начните работу над спецификациями.
      </div>
      <button
        onClick={onNew}
        className="inline-flex items-center gap-2.5 bg-bg-accent text-bg border-none rounded-[13px] py-[15px] px-[26px] font-sans text-[15px] font-semibold cursor-pointer"
      >
        <span className="text-[18px] leading-none -mt-[2px]">+</span> Новый
        проект
      </button>
    </div>
  );
}

export default function ProjectsPage() {
  const [query, setQuery] = useState("");
  const [sortBy, setSortBy] = useState<"date" | "name" | "budget">("date");

  const filtered = useMemo(() => {
    let list = [...MOCK_PROJECTS];
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      list = list.filter((p) => p.name.toLowerCase().includes(q));
    }
    list.sort((a, b) => {
      if (sortBy === "date") return b.updatedAt.localeCompare(a.updatedAt);
      if (sortBy === "name") return a.name.localeCompare(b.name, "ru");
      return b.budget - a.budget;
    });
    return list;
  }, [query, sortBy]);

  const totalBudget = MOCK_PROJECTS.reduce((s, p) => s + p.budget, 0);
  const totalItems = MOCK_PROJECTS.reduce((s, p) => s + p.items, 0);
  const activeCount = MOCK_PROJECTS.filter(
    (p) => p.status === "В работе",
  ).length;

  return (
    <div className="min-h-screen bg-bg text-fg px-[clamp(16px,4vw,48px)] pb-35">
      <div className="max-w-295 mx-auto">
        {/* Header */}
        <div className="flex items-end justify-between gap-5 flex-wrap pt-[clamp(28px,5vw,48px)]">
          <div className="w-full">
            <div className="font-mono text-[11.5px] tracking-[.1em] uppercase text-fg-muted flex gap-2 items-center">
              <span>SpecTrack</span>
              <span className="opacity-50">/</span>
              <span className="text-fg">Проекты</span>
            </div>
            <div className="flex items-center justify-between gap-3 w-full">
              <div>
                <h1 className="text-[clamp(34px,6vw,54px)] font-bold tracking-[-.02em] m-0 mt-3 leading-[0.98]">
                  Проекты
                </h1>
                <p className="text-[15px] text-fg-secondary mt-2 font-normal">
                  Ваши дизайн-проекты и спецификации
                </p>
              </div>
            </div>
          </div>

          {/* Stats pills */}
          <div className="flex items-center gap-3 flex-wrap w-full">
            <div className="flex items-center gap-2 bg-bg-card border border-border-muted rounded-[11px] py-2.5 px-4">
              <span className="size-2 rounded-full bg-bg-green flex-none" />
              <span className="font-mono text-[13px] font-semibold text-fg">
                {activeCount}
              </span>
              <span className="text-[13px] text-fg-muted">
                {plural(activeCount, "активный", "активных", "активных")}
              </span>
            </div>
            <div className="flex items-center gap-2 bg-bg-card border border-border-muted rounded-[11px] py-2.5 px-4">
              <span className="font-mono text-[13px] font-semibold text-fg">
                {totalItems}
              </span>
              <span className="text-[13px] text-fg-muted">
                {plural(totalItems, "позиция", "позиции", "позиций")}
              </span>
            </div>
            <div className="flex items-center gap-2 bg-bg-card border border-border-muted rounded-[11px] py-2.5 px-4">
              <span className="font-mono text-[13px] font-semibold text-fg">
                {fmtRub(totalBudget)}
              </span>
              <span className="text-[13px] text-fg-muted">общий бюджет</span>
            </div>

            <button className="flex items-center gap-[10px] bg-bg-accent text-bg border-none rounded-[13px] py-[15px] px-[22px] font-sans text-[15px] font-semibold cursor-pointer ml-auto">
              <span className="text-[18px] leading-none -mt-[2px]">+</span>{" "}
              Новый проект
            </button>
          </div>
        </div>

        {/* Search & Sort */}
        <div className="flex items-center gap-3 mt-9 flex-wrap">
          <div className="relative flex-1 min-w-[220px] max-w-[420px]">
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
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full bg-bg-card border border-border-muted rounded-[12px] py-3.5 pl-11 pr-4 font-sans text-[15px] text-fg placeholder:text-fg-muted outline-none focus:border-border-dash-input transition-colors"
            />
            {query && (
              <button
                onClick={() => setQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-fg-muted text-bg-card text-[12px] leading-none flex items-center justify-center border-none cursor-pointer"
                aria-label="Очистить"
              >
                ✕
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[13px] text-fg-muted font-mono tracking-[.04em] uppercase">
              Сорт.
            </span>
            {(["date", "name", "budget"] as const).map((key) => (
              <button
                key={key}
                onClick={() => setSortBy(key)}
                className={`rounded-[10px] py-2 px-3.5 font-sans text-[13.5px] font-semibold cursor-pointer border transition-colors ${
                  sortBy === key
                    ? "bg-bg-accent text-bg border-bg-accent"
                    : "bg-transparent text-fg-secondary border-border-muted hover:bg-bg-toggle"
                }`}
              >
                {key === "date"
                  ? "Дата"
                  : key === "name"
                    ? "Название"
                    : "Бюджет"}
              </button>
            ))}
          </div>
        </div>

        {/* Grid or empty */}
        {filtered.length === 0 ? (
          <EmptyState onNew={() => {}} />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5 mt-8">
            {filtered.map((p, i) => (
              <ProjectCard key={p.id} project={p} index={i} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
