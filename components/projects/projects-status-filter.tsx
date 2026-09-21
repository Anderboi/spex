"use client";

import { useSearchParams } from "next/navigation";
import { useProjectsUrl } from "@/hooks/use-projects-url";
import { PROJECTS_STATUS_OPTIONS } from "@/lib/projects/filters";
import type { ProjectStatus } from "@/lib/validations";
import { FilterSelect } from "@/components/layout/filter-select";

/** Пункт «без фильтра»: сервер трактует `status=null` как «все статусы». */
const ALL_STATUSES_LABEL = "Все статусы";

/**
 * Фильтр по статусу проекта — тот же селект, что у остальных фильтров приложения
 * (базовый нативный `<select>` выпадал из общей стилистики тулбара).
 *
 * Контрол рендерится дважды: в тулбаре на `sm+` и в нижней шторке на телефоне.
 * Сторону попапа задаёт вызывающая сторона (`side="top"` в шторке: под триггером
 * места нет), ширину — `className`.
 */
export function ProjectsStatusFilter({
  side,
  className,
}: {
  side?: "top" | "bottom";
  className?: string;
}) {
  const searchParams = useSearchParams();
  const { update } = useProjectsUrl();
  const raw = searchParams.get("status") ?? "";

  // Неизвестное значение в URL сервер трактует как «без фильтра»
  // (`parseProjectsFilters` → `.catch(null)`), поэтому и триггер должен
  // показывать «Все статусы», а не пустую подпись.
  const status = PROJECTS_STATUS_OPTIONS.some((o) => o.value === raw)
    ? (raw as ProjectStatus)
    : null;

  return (
    <FilterSelect
      ariaLabel="Статус"
      placeholder={ALL_STATUSES_LABEL}
      side={side}
      className={className}
      value={status}
      onChange={(value) => update({ status: value })}
      options={[
        { label: ALL_STATUSES_LABEL, value: null },
        ...PROJECTS_STATUS_OPTIONS,
      ]}
    />
  );
}
