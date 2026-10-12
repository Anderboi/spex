import { z } from "zod";
import { STATUS_CONFIG } from "@/lib/constants";
import type {
  ProjectsFilters,
  ProjectsSort,
  ProjectsView,
} from "@/lib/types";
import { PROJECT_STATUSES, type ProjectStatus } from "@/lib/validations";
import { singleParam } from "@/lib/query-string";

export const PROJECTS_PAGE_SIZE = 12;

export const PROJECTS_SORTS = ["date", "name", "budget"] as const satisfies readonly ProjectsSort[];

/** Дефолт парсера: и триггер сортировки, и «Сбросить» в шторке возвращают его же. */
export const DEFAULT_PROJECTS_SORT: ProjectsSort = "date";

export const PROJECTS_SORT_OPTIONS: ReadonlyArray<{
  label: string;
  value: ProjectsSort;
}> = [
  { label: "Сначала новые", value: "date" },
  { label: "По названию (А-Я)", value: "name" },
  { label: "По бюджету", value: "budget" },
];

export const PROJECTS_STATUS_OPTIONS: ReadonlyArray<{
  label: string;
  value: ProjectStatus;
}> = PROJECT_STATUSES.map((value) => ({
  value,
  label: STATUS_CONFIG[value].label,
}));

export const PROJECTS_VIEWS = ["active", "archive"] as const satisfies readonly ProjectsView[];

/**
 * Что показывает список: рабочие проекты или архив (мягко удалённые).
 *
 * `null` у пункта нет намеренно: у списка всегда есть режим, а «без фильтра»
 * здесь означало бы «и удалённые тоже» — такого представления в продукте нет.
 */
export const PROJECTS_VIEW_OPTIONS: ReadonlyArray<{
  label: string;
  value: ProjectsView;
}> = [
  { label: "Активные", value: "active" },
  { label: "Архив", value: "archive" },
];

export const DEFAULT_PROJECTS_VIEW: ProjectsView = "active";

const sortSchema = z.enum(PROJECTS_SORTS);
const statusSchema = z.enum(PROJECT_STATUSES).nullable();
const viewSchema = z.enum(PROJECTS_VIEWS);

export const projectsFiltersSchema = z.object({
  query: z.string().trim().max(100).catch(""),
  status: statusSchema.catch(null),
  view: viewSchema.catch(DEFAULT_PROJECTS_VIEW),
  sort: sortSchema.catch(DEFAULT_PROJECTS_SORT),
  page: z.coerce.number().int().min(1).max(100_000).catch(1),
});

export const DEFAULT_PROJECTS_FILTERS: ProjectsFilters = {
  query: "",
  status: null,
  view: DEFAULT_PROJECTS_VIEW,
  sort: DEFAULT_PROJECTS_SORT,
  page: 1,
};

export type ProjectsSearchParams = Record<
  string,
  string | string[] | undefined
>;

export function parseProjectsFilters(
  sp: ProjectsSearchParams,
): ProjectsFilters {
  const parsed = projectsFiltersSchema.safeParse({
    query: singleParam(sp.query) ?? "",
    status: singleParam(sp.status) ?? null,
    view: singleParam(sp.view) ?? DEFAULT_PROJECTS_VIEW,
    sort: singleParam(sp.sort) ?? DEFAULT_PROJECTS_SORT,
    page: singleParam(sp.page) ?? "1",
  });

  if (!parsed.success) return DEFAULT_PROJECTS_FILTERS;
  return parsed.data;
}

const RESET_PAGE_KEYS = ["query", "status", "view", "sort"] as const;

export function updateProjectsSearchParams(
  current: URLSearchParams,
  patch: Partial<ProjectsFilters>,
): string {
  const next = new URLSearchParams(current.toString());

  for (const key of Object.keys(patch) as (keyof ProjectsFilters)[]) {
    const value = patch[key];
    if (isEmptyValue(key, value)) next.delete(key);
    else next.set(key, String(value));
  }

  if (RESET_PAGE_KEYS.some((key) => key in patch)) next.delete("page");

  return next.toString();
}

function isEmptyValue(key: keyof ProjectsFilters, value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (key === "page") return Number(value) <= 1;
  if (key === "sort") return value === DEFAULT_PROJECTS_FILTERS.sort;
  // Режим по умолчанию в URL не пишется: `?view=active` — шум, а парсер и так
  // трактует отсутствие параметра как «активные».
  if (key === "view") return value === DEFAULT_PROJECTS_VIEW;
  return value === "";
}
