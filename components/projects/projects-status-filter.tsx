"use client";

import { useSearchParams } from "next/navigation";
import { useProjectsUrl } from "@/hooks/use-projects-url";
import { PROJECTS_STATUS_OPTIONS } from "@/lib/projects/filters";
import type { ProjectStatus } from "@/lib/validations";

export function ProjectsStatusFilter() {
  const searchParams = useSearchParams();
  const { update } = useProjectsUrl();
  const status = searchParams.get("status") ?? "";

  return (
    <select
      value={status}
      onChange={(e) =>
        update({
          status: e.target.value ? (e.target.value as ProjectStatus) : null,
        })
      }
      aria-label="Статус"
      className="h-10 cursor-pointer appearance-none rounded-lg border border-border bg-bg-card px-3 font-mono text-xs text-fg outline-none transition-colors hover:bg-bg-brand/50"
    >
      <option value="">Все статусы</option>
      {PROJECTS_STATUS_OPTIONS.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
