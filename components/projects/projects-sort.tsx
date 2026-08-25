"use client";

import { ArrowUpDown } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useProjectsUrl } from "@/hooks/use-projects-url";
import { PROJECTS_SORT_OPTIONS } from "@/lib/projects/filters";
import type { ProjectsSort } from "@/lib/types";

export function ProjectsSort() {
  const searchParams = useSearchParams();
  const { update } = useProjectsUrl();
  const sort = (searchParams.get("sort") ?? "date") as ProjectsSort;

  return (
    <div className="relative inline-flex items-center">
      <select
        value={sort}
        onChange={(e) => update({ sort: e.target.value as ProjectsSort })}
        aria-label="Сортировка"
        className="h-10 cursor-pointer appearance-none rounded-lg border border-border bg-bg-card pl-3 pr-7 font-mono text-xs text-fg outline-none transition-colors hover:bg-bg-brand/50"
      >
        {PROJECTS_SORT_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ArrowUpDown className="pointer-events-none absolute right-2.5 size-3.5 text-fg-muted" />
    </div>
  );
}
