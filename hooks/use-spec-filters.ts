"use client";

import { useCallback, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ALL_CATEGORIES, SPEC_STATUSES, type SpecStatus } from '@/lib/constants';

export type SpecSort = "code" | "az" | "sum";

/** Контракт фильтров спецификации: нужен потребителям (шторка фильтров),
 *  чтобы не тянуть тип через пропсы вручную. */
export type SpecFilters = ReturnType<typeof useSpecFilters>;

export function useSpecFilters() {
  const sp = useSearchParams();
  const [, force] = useState(0);

  // Next 15+: history.replaceState обновляет URL без обращения к серверу.
  // Для фильтрации уже загруженного массива поход на сервер не нужен.
  const setParam = useCallback((key: string, value: string | null) => {
    const next = new URLSearchParams(window.location.search);
    if (value) next.set(key, value);
    else next.delete(key);
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${next.toString() ? `?${next}` : ""}`,
    );
    force((n) => n + 1);
  }, []);

  const query = sp.get("q") ?? "";
  const activeType = sp.get("type") ?? ALL_CATEGORIES;
  // Неизвестное значение в URL — то же, что «без фильтра»: иначе шторка
  // показывала бы «Все статусы», а список оставался пустым.
  const statusRaw = sp.get("status") ?? "";
  const statusFilter: SpecStatus | null = (
    SPEC_STATUSES as readonly string[]
  ).includes(statusRaw)
    ? (statusRaw as SpecStatus)
    : null;
  const sort = (sp.get("sort") as SpecSort) ?? "code";

  return useMemo(
    () => ({
      query,
      activeType,
      statusFilter,
      sort,
      setQuery: (v: string) => setParam("q", v.trim() || null),
      setActiveType: (v: string) =>
        setParam("type", v === ALL_CATEGORIES ? null : v),
      setStatusFilter: (v: SpecStatus | null) => setParam("status", v),
      setSort: (v: SpecSort) => setParam("sort", v === "code" ? null : v),
      reset: () => {
        window.history.replaceState(null, "", window.location.pathname);
        force((n) => n + 1);
      },
      isFiltered: Boolean(
        query || statusFilter || activeType !== ALL_CATEGORIES,
      ),
    }),
    [query, activeType, statusFilter, sort, setParam],
  );
}
