"use client";

import { useSearchParams } from "next/navigation";
import { useProjectsUrl } from "@/hooks/use-projects-url";
import {
  DEFAULT_PROJECTS_SORT,
  PROJECTS_SORTS,
  PROJECTS_SORT_OPTIONS,
} from "@/lib/projects/filters";
import type { ProjectsSort as ProjectsSortValue } from "@/lib/types";
import { FilterSelect } from "@/components/layout/filter-select";

/**
 * Сортировка списка проектов — тот же селект, что в библиотеке материалов.
 *
 * «Без сортировки» не существует: сервер всегда сортирует, а неизвестное
 * значение в URL заменяет на дефолт (`parseProjectsFilters` →
 * `.catch(DEFAULT_PROJECTS_SORT)`) — триггер должен показывать то же самое.
 *
 * Контрол рендерится дважды: в тулбаре на `sm+` и в нижней шторке на телефоне.
 * Видимость задаёт вызывающая сторона через `className`, сторону попапа —
 * `side` (в шторке `top`: под триггером места нет).
 */
export function ProjectsSort({
  side,
  className,
}: {
  side?: "top" | "bottom";
  className?: string;
}) {
  const searchParams = useSearchParams();
  const { update } = useProjectsUrl();
  const raw = searchParams.get("sort") ?? "";

  const sort = (PROJECTS_SORTS as readonly string[]).includes(raw)
    ? (raw as ProjectsSortValue)
    : DEFAULT_PROJECTS_SORT;

  return (
    <FilterSelect
      ariaLabel="Сортировка"
      placeholder="Сортировка"
      side={side}
      className={className}
      value={sort}
      onChange={(value) => update({ sort: value ?? DEFAULT_PROJECTS_SORT })}
      options={PROJECTS_SORT_OPTIONS}
    />
  );
}
