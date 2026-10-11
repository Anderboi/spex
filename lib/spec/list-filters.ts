import { ALL_CATEGORIES, type SpecStatus } from "../constants";
import type { SpecItem } from "../types";

/**
 * Выборка списка позиций спецификации: фильтры и сортировка.
 *
 * Раньше это жило прямо в `useMemo` конструктора (`hooks/use-spec-builder.ts`).
 * Правила — единственное место, где решается, что видит пользователь, и они
 * проверяемы без рендера: хуком их не протестировать, а разметкой — тем более.
 * Отсюда отдельный модуль (`lib/spec/*` — дом, где такие правила и живут).
 *
 * Значения приходят из URL (`hooks/use-spec-filters.ts`): фильтрация идёт по уже
 * загруженному массиву позиций, похода на сервер нет.
 */

/** Сортировка списка: по марке, по названию (А→Я), по сумме позиции. */
export type SpecSort = "code" | "az" | "sum";

export type SpecListFilters = {
  query: string;
  /** Категория (раздел) спецификации или `ALL_CATEGORIES` — «без фильтра». */
  type: string;
  status: SpecStatus | null;
  /**
   * Компания-поставщик позиции. Сравнивается со снапшотом имени
   * (`SpecItem.companyName`), а не с `companyId`: у позиции, чей поставщик
   * удалён из справочника, id уже нет, а имя осталось — по id такая позиция
   * выпала бы из фильтра молча.
   */
  company: string | null;
  sort: SpecSort;
};

/** Позиция проходит все фильтры списка? Поиск — по названию, бренду, марке, характеристикам и артикулу. */
export function matchesSpecListFilters(
  item: SpecItem,
  filters: SpecListFilters,
): boolean {
  if (filters.type !== ALL_CATEGORIES && item.type !== filters.type) {
    return false;
  }
  if (filters.status && item.status !== filters.status) return false;
  if (filters.company && item.companyName.trim() !== filters.company) {
    return false;
  }

  const query = filters.query.trim().toLowerCase();
  if (query) {
    const haystack =
      `${item.name} ${item.brand} ${item.code} ${item.spec} ${item.article}`.toLowerCase();
    if (!haystack.includes(query)) return false;
  }

  return true;
}

/**
 * Отфильтрованный и отсортированный список — то, что рисует таблица.
 *
 * В списке остаются все позиции, включая дочерние: `parentId` — обычная связь
 * «позиция → позиция», а не принадлежность составу (у состава своя таблица
 * `spec_item_components`, её строки сюда не попадают).
 */
export function selectSpecList(
  items: readonly SpecItem[],
  filters: SpecListFilters,
): SpecItem[] {
  const filtered = items.filter((item) =>
    matchesSpecListFilters(item, filters),
  );

  const sorted = [...filtered];
  if (filters.sort === "az") {
    sorted.sort((a, b) => a.name.localeCompare(b.name, "ru"));
  } else if (filters.sort === "sum") {
    sorted.sort((a, b) => b.qty * b.price - a.qty * a.price);
  } else {
    sorted.sort((a, b) =>
      a.code.localeCompare(b.code, "ru", { numeric: true }),
    );
  }

  return sorted;
}

/** Сколько позиций в каждой категории — счётчики чипсов и шторки. */
export function specTypeCounts(
  items: readonly SpecItem[],
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    counts[item.type] = (counts[item.type] ?? 0) + 1;
  }
  return counts;
}

/** Сколько позиций в каждом статусе — счётчики селекта статусов. */
export function specStatusCounts(
  items: readonly SpecItem[],
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    counts[item.status] = (counts[item.status] ?? 0) + 1;
  }
  return counts;
}

/** Позиции, которые ещё не подобраны — «черновики» (см. `DRAFT_STATUS`). */
export const DRAFT_STATUS: SpecStatus = "draft";

export function countDrafts(items: readonly SpecItem[]): number {
  return items.reduce((n, item) => n + (item.status === DRAFT_STATUS ? 1 : 0), 0);
}

export type SpecSupplierOption = {
  /** Имя компании — оно же значение фильтра в URL. */
  name: string;
  count: number;
};

/**
 * Компании-поставщики, которые встречаются в позициях проекта: варианты
 * фильтра «Поставщик». Позиции без поставщика в список не попадают — выбирать
 * там нечего, а счётчик компании считает только её позиции.
 *
 * Порядок — по алфавиту: список строится из данных, а не из справочника
 * компаний, и «сначала новые» здесь читалось бы как случайный порядок.
 */
export function specSupplierOptions(
  items: readonly SpecItem[],
): SpecSupplierOption[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    const name = item.companyName.trim();
    if (!name) continue;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => a.name.localeCompare(b.name, "ru"));
}
