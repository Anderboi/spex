import { z } from "zod";
import { STATUS_CONFIG } from "@/lib/constants";
import type { ProjectsFilters, ProjectsSort } from "@/lib/types";
import { PROJECT_STATUSES, type ProjectStatus } from "@/lib/validations";

export const PROJECTS_PAGE_SIZE = 12;

export const PROJECTS_SORTS = ["date", "name", "budget"] as const satisfies readonly ProjectsSort[];

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

const sortSchema = z.enum(PROJECTS_SORTS);
const statusSchema = z.enum(PROJECT_STATUSES).nullable();

export const projectsFiltersSchema = z.object({
  query: z.string().trim().max(100).catch(""),
  status: statusSchema.catch(null),
  sort: sortSchema.catch("date"),
  page: z.coerce.number().int().min(1).max(100_000).catch(1),
});

export const DEFAULT_PROJECTS_FILTERS: ProjectsFilters = {
  query: "",
  status: null,
  sort: "date",
  page: 1,
};

export type ProjectsSearchParams = Record<
  string,
  string | string[] | undefined
>;

function toSingle(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function parseProjectsFilters(
  sp: ProjectsSearchParams,
): ProjectsFilters {
  const parsed = projectsFiltersSchema.safeParse({
    query: toSingle(sp.query) ?? "",
    status: toSingle(sp.status) ?? null,
    sort: toSingle(sp.sort) ?? "date",
    page: toSingle(sp.page) ?? "1",
  });

  if (!parsed.success) return DEFAULT_PROJECTS_FILTERS;
  return parsed.data;
}

const RESET_PAGE_KEYS = ["query", "status", "sort"] as const;

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
  return value === "";
}
