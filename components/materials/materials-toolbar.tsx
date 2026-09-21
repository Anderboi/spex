"use client";

import { MaterialsSort } from "./materials-sort";
import { MaterialsCategoryFilter } from "./materials-category-filter";
import { MaterialsCategorySelect } from "./materials-category-select";
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
 * работает как раньше), под ней чипсы категорий.
 *
 * `< sm` — один ряд: свёрнутый поиск, категория и кнопка шторки со вторичными
 * фильтрами (ряд рисует сам `SearchBlock` — он же убирает соседей, пока
 * развёрнуто поле). Так же, как в каталоге контактов. Категория остаётся
 * снаружи: это основной разрез библиотеки, и прятать её за лишний тап незачем.
 * Чипсы на `< sm` не рендерятся вовсе (`hidden sm:block`) — иначе мобильный
 * селект `MaterialsCategoryFilter` давал бы второй контрол категории строкой.
 */
export function MaterialsToolbar({ brands }: { brands: MaterialBrands }) {
  const mobileRow = (
    <>
      <MaterialsCategorySelect className="min-w-0 flex-1 sm:hidden" />
      {/* `sm:hidden` — кнопка живёт в мобильном ряду; на `sm+` вторичные фильтры
          стоят в тулбаре, и шторка не нужна. */}
      <MaterialsFilterSheet brands={brands} className="sm:hidden" />
    </>
  );

  return (
    <div className="space-y-3">
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <SearchBlock
          useSearchUrl={useMaterialsUrl}
          placeholder="Поиск по материалам, артикулам, брендам…"
          collapsible
          expandedContent={mobileRow}
        />

        <div className="hidden sm:contents">
          <MaterialsManufacturerFilter brands={brands} />
          <MaterialsStatusFilter />
          <MaterialsSort />
        </div>
      </div>
      {/* Чипсы категорий — только на `sm+`: на телефоне категория уже стоит в
          ряду выше, и второй её контрол занял бы ещё одну строку. */}
      <MaterialsCategoryFilter className="mb-4 hidden sm:block" />
    </div>
  );
}
