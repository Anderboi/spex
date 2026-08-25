import { z } from "zod";
import type { MaterialsFilters, MaterialsSort } from "@/lib/types";

export const MATERIALS_PAGE_SIZE = 12;

export const MATERIALS_SORTS = [
  "created_desc",
  "created_asc",
  "name_asc",
  "name_desc",
] as const satisfies readonly MaterialsSort[];

export const MATERIALS_SORT_OPTIONS: ReadonlyArray<{
  label: string;
  value: MaterialsSort;
}> = [
  { label: "Сначала новые", value: "created_desc" },
  { label: "Сначала старые", value: "created_asc" },
  { label: "По названию (А-Я)", value: "name_asc" },
  { label: "По названию (Я-А)", value: "name_desc" },
];

export const MATERIALS_STATUSES = ["active", "archived"] as const;
export type MaterialStatus = (typeof MATERIALS_STATUSES)[number];

const sortSchema = z.enum(MATERIALS_SORTS);
const statusSchema = z.enum(MATERIALS_STATUSES).nullable();

export const materialsFiltersSchema = z.object({
  query: z.string().trim().max(100).catch(""),
  category: z.string().trim().max(120).nullable().catch(null),
  manufacturer: z.string().trim().max(200).nullable().catch(null),
  status: statusSchema.catch(null),
  sort: sortSchema.catch("created_desc"),
  page: z.coerce.number().int().min(1).max(100_000).catch(1),
});

export const DEFAULT_MATERIALS_FILTERS: MaterialsFilters = {
  query: "",
  category: null,
  manufacturer: null,
  status: null,
  sort: "created_desc",
  page: 1,
};

export type MaterialsSearchParams = Record<
  string,
  string | string[] | undefined
>;

function toSingle(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function parseMaterialsFilters(
  sp: MaterialsSearchParams,
): MaterialsFilters {
  const parsed = materialsFiltersSchema.safeParse({
    query: toSingle(sp.query) ?? "",
    category: toSingle(sp.category) ?? null,
    manufacturer: toSingle(sp.manufacturer) ?? null,
    status: toSingle(sp.status) ?? null,
    sort: toSingle(sp.sort) ?? "created_desc",
    page: toSingle(sp.page) ?? "1",
  });

  if (!parsed.success) return DEFAULT_MATERIALS_FILTERS;
  return parsed.data;
}

const RESET_PAGE_KEYS = [
  "query",
  "category",
  "manufacturer",
  "status",
  "sort",
] as const;

export function updateMaterialsSearchParams(
  current: URLSearchParams,
  patch: Partial<MaterialsFilters>,
): string {
  const next = new URLSearchParams(current.toString());

  for (const key of Object.keys(patch) as (keyof MaterialsFilters)[]) {
    const value = patch[key];
    if (isEmptyValue(key, value)) next.delete(key);
    else next.set(key, String(value));
  }

  if (RESET_PAGE_KEYS.some((key) => key in patch)) next.delete("page");

  return next.toString();
}

function isEmptyValue(key: keyof MaterialsFilters, value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (key === "page") return Number(value) <= 1;
  if (key === "sort") return value === DEFAULT_MATERIALS_FILTERS.sort;
  return value === "";
}
