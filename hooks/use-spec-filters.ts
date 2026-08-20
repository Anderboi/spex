"use client";

import { useCallback, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { SpecStatus } from '@/lib/constants';

export type SpecSort = "code" | "az" | "sum";

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
  const activeType = sp.get("type") ?? "Все типы";
  const statusFilter = (sp.get("status") as SpecStatus | null) ?? null;
  const sort = (sp.get("sort") as SpecSort) ?? "code";

  return useMemo(
    () => ({
      query,
      activeType,
      statusFilter,
      sort,
      setQuery: (v: string) => setParam("q", v.trim() || null),
      setActiveType: (v: string) =>
        setParam("type", v === "Все типы" ? null : v),
      setStatusFilter: (v: SpecStatus | null) => setParam("status", v),
      setSort: (v: SpecSort) => setParam("sort", v === "code" ? null : v),
      reset: () => {
        window.history.replaceState(null, "", window.location.pathname);
        force((n) => n + 1);
      },
      isFiltered: Boolean(query || statusFilter || activeType !== "Все типы"),
    }),
    [query, activeType, statusFilter, sort, setParam],
  );
}
