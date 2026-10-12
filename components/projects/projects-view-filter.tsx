"use client";

import { useSearchParams } from "next/navigation";
import { useProjectsUrl } from "@/hooks/use-projects-url";
import {
  DEFAULT_PROJECTS_VIEW,
  PROJECTS_VIEWS,
  PROJECTS_VIEW_OPTIONS,
} from "@/lib/projects/filters";
import type { ProjectsView } from "@/lib/types";
import { FilterSelect } from "@/components/layout/filter-select";

/**
 * Режим списка проектов: рабочие проекты или архив (мягко удалённые).
 *
 * Контрол рендерится дважды: в тулбаре на `sm+` и в нижней шторке на телефоне —
 * как остальные фильтры списка. Неизвестное значение в URL сервер трактует как
 * «активные» (`parseProjectsFilters` → `.catch`), поэтому и триггер показывает
 * «Активные», а не пустую подпись.
 *
 * Слово «архив» здесь означает корзину (`deleted_at`), а не статус проекта
 * «В архиве»: это разные вещи, и режим списка вторым не управляет.
 */
export function ProjectsViewFilter({
  side,
  className,
}: {
  side?: "top" | "bottom";
  className?: string;
}) {
  const searchParams = useSearchParams();
  const { update } = useProjectsUrl();
  const raw = searchParams.get("view") ?? "";

  const view: ProjectsView = (PROJECTS_VIEWS as readonly string[]).includes(raw)
    ? (raw as ProjectsView)
    : DEFAULT_PROJECTS_VIEW;

  return (
    <FilterSelect
      ariaLabel="Показывать проекты"
      placeholder="Активные"
      side={side}
      className={className}
      value={view}
      onChange={(next) => update({ view: next ?? DEFAULT_PROJECTS_VIEW })}
      options={PROJECTS_VIEW_OPTIONS}
    />
  );
}
