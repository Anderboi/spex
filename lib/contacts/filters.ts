import { z } from "zod";
import type { ContactsFilters, ContactsSort, ContactsTab } from "@/lib/types";

export const CONTACTS_PAGE_SIZE = 12;

export const CONTACTS_SORTS = [
  "created_desc",
  "created_asc",
  "name_asc",
  "name_desc",
] as const satisfies readonly ContactsSort[];

/** Порядок пунктов совпадает с сортировкой материалов (`MATERIALS_SORT_OPTIONS`). */
export const CONTACTS_SORT_OPTIONS: ReadonlyArray<{
  label: string;
  value: ContactsSort;
}> = [
  { label: "Сначала новые", value: "created_desc" },
  { label: "Сначала старые", value: "created_asc" },
  { label: "По названию (А-Я)", value: "name_asc" },
  { label: "По названию (Я-А)", value: "name_desc" },
];

export const CONTACTS_TABS = ["companies", "independent"] as const satisfies readonly ContactsTab[];

const sortSchema = z.enum(CONTACTS_SORTS);
const tabSchema = z.enum(CONTACTS_TABS);

export const contactsFiltersSchema = z.object({
  query: z.string().trim().max(100).catch(""),
  category: z.string().trim().max(120).nullable().catch(null),
  tab: tabSchema.catch("companies"),
  sort: sortSchema.catch("created_desc"),
  page: z.coerce.number().int().min(1).max(100_000).catch(1),
});

export const DEFAULT_CONTACTS_FILTERS: ContactsFilters = {
  query: "",
  category: null,
  tab: "companies",
  sort: "created_desc",
  page: 1,
};

export type ContactsSearchParams = Record<
  string,
  string | string[] | undefined
>;

function toSingle(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function parseContactsFilters(
  sp: ContactsSearchParams,
): ContactsFilters {
  const parsed = contactsFiltersSchema.safeParse({
    query: toSingle(sp.query) ?? "",
    category: toSingle(sp.category) ?? null,
    tab: toSingle(sp.tab) ?? "companies",
    sort: toSingle(sp.sort) ?? "created_desc",
    page: toSingle(sp.page) ?? "1",
  });

  if (!parsed.success) return DEFAULT_CONTACTS_FILTERS;
  return parsed.data;
}

const RESET_PAGE_KEYS = ["query", "category", "tab", "sort"] as const;

export function updateContactsSearchParams(
  current: URLSearchParams,
  patch: Partial<ContactsFilters>,
): string {
  const next = new URLSearchParams(current.toString());

  for (const key of Object.keys(patch) as (keyof ContactsFilters)[]) {
    const value = patch[key];
    if (isEmptyValue(key, value)) next.delete(key);
    else next.set(key, String(value));
  }

  if (RESET_PAGE_KEYS.some((key) => key in patch)) next.delete("page");

  return next.toString();
}

function isEmptyValue(key: keyof ContactsFilters, value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (key === "page") return Number(value) <= 1;
  if (key === "sort") return value === DEFAULT_CONTACTS_FILTERS.sort;
  if (key === "tab") return value === DEFAULT_CONTACTS_FILTERS.tab;
  return value === "";
}
