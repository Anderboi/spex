"use client";

import { MaterialsSort } from "./materials-sort";
import { MaterialsCategoryFilter } from "./materials-category-filter";
import { MaterialsManufacturerFilter } from "./materials-manufacturer-filter";
import { MaterialsStatusFilter } from "./materials-status-filter";
import { SearchBlock } from "../layout/search-block";
import { useMaterialsUrl } from "@/hooks/use-materials-url";

export function MaterialsToolbar({ brands }: { brands: string[] }) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 mt-5">
        <SearchBlock
          useSearchUrl={useMaterialsUrl}
          className="min-w-60 flex-1"
          placeholder="Поиск по материалам, артикулам, брендам…"
        />
        <MaterialsManufacturerFilter brands={brands} />
        <MaterialsStatusFilter />
        <MaterialsSort />
      </div>
      <MaterialsCategoryFilter className="mb-4" />
    </div>
  );
}
