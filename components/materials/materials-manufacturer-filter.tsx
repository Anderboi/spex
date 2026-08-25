"use client";

import { useSearchParams } from "next/navigation";
import { useMaterialsUrl } from "../../hooks/use-materials-url";

export function MaterialsManufacturerFilter({ brands }: { brands: string[] }) {
  const searchParams = useSearchParams();
  const { update } = useMaterialsUrl();
  const manufacturer = searchParams.get("manufacturer") ?? "";

  return (
    <select
      value={manufacturer}
      onChange={(e) => update({ manufacturer: e.target.value || null })}
      aria-label="Производитель"
      className="h-10 cursor-pointer appearance-none rounded-lg border border-border bg-bg-card px-3 font-mono text-xs text-fg outline-none transition-colors hover:bg-bg-brand/50"
    >
      <option value="">Все производители</option>
      {brands.map((b) => (
        <option key={b} value={b}>
          {b}
        </option>
      ))}
    </select>
  );
}
