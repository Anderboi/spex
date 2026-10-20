import { z } from "zod";
import type { MaterialsFilters, MaterialsSort } from "@/lib/types";
import { singleParam } from "@/lib/query-string";

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

/**
 * Режим «Архив» библиотеки.
 *
 * В нём нельзя управлять отметками, поэтому переключатель «Избранное» не
 * показывается, а параметр снимается при сборке адреса: иначе список остался бы
 * пустым без видимой причины. Правило одно на разбор адреса, его сборку и оба
 * контрола — чтобы они не разошлись.
 */
export function isMaterialsArchiveStatus(
  status: string | null | undefined,
): boolean {
  return status === "archived";
}

const sortSchema = z.enum(MATERIALS_SORTS);
const statusSchema = z.enum(MATERIALS_STATUSES).nullable();

export const materialsFiltersSchema = z.object({
  query: z.string().trim().max(100).catch(""),
  category: z.string().trim().max(120).nullable().catch(null),
  manufacturer: z.string().trim().max(200).nullable().catch(null),
  company: z.string().trim().max(64).nullable().catch(null),
  status: statusSchema.catch(null),
  favorite: z.boolean().catch(false),
  sort: sortSchema.catch("created_desc"),
  page: z.coerce.number().int().min(1).max(100_000).catch(1),
});

export const DEFAULT_MATERIALS_FILTERS: MaterialsFilters = {
  query: "",
  category: null,
  manufacturer: null,
  company: null,
  status: null,
  favorite: false,
  sort: "created_desc",
  page: 1,
};

export type MaterialsSearchParams = Record<
  string,
  string | string[] | undefined
>;

/**
 * Активные фильтры библиотеки: всё, кроме сортировки и номера страницы.
 *
 * Список сужают только они; поэтому пустой результат при одном «Избранном»
 * объясняется отдельно, а не общим «Ничего не найдено».
 */
export function hasMaterialsFilters(filters: MaterialsFilters): boolean {
  return filters.favorite || hasNarrowingFilters(filters);
}

/** Включено только «Избранное», других сужающих фильтров нет. */
export function isMaterialsFavoriteOnly(filters: MaterialsFilters): boolean {
  return filters.favorite && !hasNarrowingFilters(filters);
}

function hasNarrowingFilters(
  filters: Omit<MaterialsFilters, "favorite">,
): boolean {
  return Boolean(
    filters.query ||
      filters.category ||
      filters.manufacturer ||
      filters.company ||
      filters.status,
  );
}

/**
 * Тот же разбор, но из `URLSearchParams` (клиентские контролы).
 *
 * Повторяющийся параметр читается первым значением — как `singleParam` у
 * сервера, поэтому адрес с дублем не даёт на клиенте другое состояние.
 */
export function parseMaterialsFiltersFromSearchParams(params: {
  keys(): IterableIterator<string>;
  getAll(key: string): string[];
}): MaterialsFilters {
  const sp: MaterialsSearchParams = {};

  for (const key of new Set(params.keys())) {
    const values = params.getAll(key);
    sp[key] = values.length > 1 ? values : values[0];
  }

  return parseMaterialsFilters(sp);
}

export function parseMaterialsFilters(
  sp: MaterialsSearchParams,
): MaterialsFilters {
  const parsed = materialsFiltersSchema.safeParse({
    query: singleParam(sp.query) ?? "",
    category: singleParam(sp.category) ?? null,
    manufacturer: singleParam(sp.manufacturer) ?? null,
    company: singleParam(sp.company) ?? null,
    status: singleParam(sp.status) ?? null,
    favorite: singleParam(sp.favorite) === "1",
    sort: singleParam(sp.sort) ?? "created_desc",
    page: singleParam(sp.page) ?? "1",
  });

  if (!parsed.success) return DEFAULT_MATERIALS_FILTERS;

  // В архиве переключателя нет, а отметки там не управляются. Параметр в
  // старом адресе не должен молча обрезать список: сервер его игнорирует.
  if (isMaterialsArchiveStatus(parsed.data.status)) {
    return { ...parsed.data, favorite: false };
  }
  return parsed.data;
}

const RESET_PAGE_KEYS = [
  "query",
  "category",
  "manufacturer",
  "company",
  "status",
  "favorite",
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
    // Булевы фильтры в адресе живут короткой формой: `favorite=1`, а не
    // `favorite=true` — так же их читает `parseMaterialsFilters`.
    else next.set(key, key === "favorite" ? "1" : String(value));
  }

  if (RESET_PAGE_KEYS.some((key) => key in patch)) next.delete("page");

  // В режиме «Архив» переключателя «Избранное» нет: список остался бы пустым
  // без видимой причины, а пополнить его там нельзя. Поэтому архив вытесняет
  // параметр и из адреса — в том числе при смене другого фильтра.
  if (isMaterialsArchiveStatus(next.get("status"))) next.delete("favorite");

  return next.toString();
}

function isEmptyValue(key: keyof MaterialsFilters, value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (key === "page") return Number(value) <= 1;
  if (key === "favorite") return value !== true;
  if (key === "sort") return value === DEFAULT_MATERIALS_FILTERS.sort;
  return value === "";
}
