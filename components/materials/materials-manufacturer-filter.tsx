"use client";

import { useSearchParams } from "next/navigation";
import { useMaterialsUrl } from "../../hooks/use-materials-url";
import type { MaterialBrands } from "@/lib/queries";
import { MaterialsFilterSelect } from "./materials-filter-select";

const ALL_BRANDS_LABEL = "Все производители";

export function MaterialsManufacturerFilter({
  brands,
  side,
  className,
}: {
  brands: MaterialBrands;
  side?: "top" | "bottom";
  className?: string;
}) {
  const searchParams = useSearchParams();
  const { update } = useMaterialsUrl();
  const manufacturer = searchParams.get("manufacturer") ?? "";

  // Активный фильтр из URL может отсутствовать в списке (материал с этим
  // брендом заархивирован, или запрос списка не удался) — его всё равно надо
  // показать, иначе значение фильтра не видно и не снять.
  const options =
    manufacturer && !brands.items.includes(manufacturer)
      ? [manufacturer, ...brands.items]
      : brands.items;

  const hasOptions = options.length > 0;

  // Пустой фильтр должен объяснять причину, а не выглядеть «незагруженным».
  // При пустом списке пунктов нет, поэтому подпись берётся из placeholder.
  const placeholder = hasOptions
    ? ALL_BRANDS_LABEL
    : brands.failed
      ? "Список не загрузился"
      : "Производители не указаны";

  return (
    <MaterialsFilterSelect
      ariaLabel="Производитель"
      placeholder={placeholder}
      side={side}
      className={className}
      disabled={!hasOptions}
      value={manufacturer || null}
      onChange={(value) => update({ manufacturer: value })}
      options={
        hasOptions
          ? [
              { label: ALL_BRANDS_LABEL, value: null },
              ...options.map((brand) => ({ label: brand, value: brand })),
            ]
          : []
      }
    />
  );
}
