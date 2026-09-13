"use client";

import { MaterialsSort } from "./materials-sort";
import { MaterialsCategoryFilter } from "./materials-category-filter";
import { MaterialsManufacturerFilter } from "./materials-manufacturer-filter";
import { MaterialsStatusFilter } from "./materials-status-filter";
import { MaterialsFilterSheet } from "./materials-filter-sheet";
import { SearchBlock } from "../layout/search-block";
import { useMaterialsUrl } from "@/hooks/use-materials-url";
import type { MaterialBrands } from "@/lib/queries";

/**
 * Тулбар библиотеки материалов.
 *
 * `sm+` — поиск и три контрола в одной переносящейся строке (обёртка с
 * `sm:contents` отдаёт свои children внешнему flex-контейнеру, поэтому перенос
 * работает как раньше). `< sm` — поиск и кнопка шторки с вторичными фильтрами;
 * ряд категорий остаётся видимым в обоих случаях.
 */
export function MaterialsToolbar({ brands }: { brands: MaterialBrands }) {
  return (
    <div className="space-y-3">
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <SearchBlock
          useSearchUrl={useMaterialsUrl}
          className="min-w-0 flex-1 sm:min-w-60"
          placeholder="Поиск по материалам, артикулам, брендам…"
        />

        <div className="hidden sm:contents">
          <MaterialsManufacturerFilter brands={brands} />
          <MaterialsStatusFilter />
          <MaterialsSort />
        </div>

        <MaterialsFilterSheet brands={brands} />
      </div>
      <MaterialsCategoryFilter className="mb-4" />
    </div>
  );
}
