"use client";

import { useCallback, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ALL_CATEGORIES, SPEC_STATUSES, type SpecStatus } from '@/lib/constants';
import { DRAFT_STATUS, type SpecSort } from "@/lib/spec/list-filters";

/** Контракт фильтров спецификации: нужен потребителям (шторка фильтров, тулбар),
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
  /**
   * Компания-поставщик позиции — имя, а не id (см. `SpecListFilters.company`).
   * Пустая строка в URL (`?company=`) — это «без фильтра», а не компания
   * с пустым именем.
   */
  const company = sp.get("company")?.trim() || null;
  /**
   * «Только черновики» — не отдельный параметр, а псевдоним статуса `draft`
   * («Не выбрано»). Так у одного измерения один источник правды: иначе в URL
   * могли бы оказаться `draft=1` и `status=picked` одновременно, и список был
   * бы пуст при двух «включённых» фильтрах.
   */
  const draftOnly = statusFilter === DRAFT_STATUS;

  return useMemo(
    () => ({
      query,
      activeType,
      statusFilter,
      company,
      sort,
      draftOnly,
      setQuery: (v: string) => setParam("q", v.trim() || null),
      setActiveType: (v: string) =>
        setParam("type", v === ALL_CATEGORIES ? null : v),
      setStatusFilter: (v: SpecStatus | null) => setParam("status", v),
      setCompany: (v: string | null) => setParam("company", v),
      setDraftOnly: (on: boolean) => {
        if (on) setParam("status", DRAFT_STATUS);
        else if (draftOnly) setParam("status", null);
      },
      setSort: (v: SpecSort) => setParam("sort", v === "code" ? null : v),
      reset: () => {
        window.history.replaceState(null, "", window.location.pathname);
        force((n) => n + 1);
      },
      isFiltered: Boolean(
        query || statusFilter || company || activeType !== ALL_CATEGORIES,
      ),
    }),
    [
      query,
      activeType,
      statusFilter,
      company,
      sort,
      draftOnly,
      setParam,
    ],
  );
}
