"use client";

import { useSearchParams } from "next/navigation";
import { useMaterialsUrl } from "../../hooks/use-materials-url";
import type { MaterialStatus } from "@/lib/materials/filters";

export function MaterialsStatusFilter() {
  const searchParams = useSearchParams();
  const { update } = useMaterialsUrl();
  const status = searchParams.get("status") ?? "";

  return (
    <select
      value={status}
      onChange={(e) =>
        update({
          status: e.target.value ? (e.target.value as MaterialStatus) : null,
        })
      }
      aria-label="Статус"
      className="h-10 cursor-pointer appearance-none rounded-lg border border-border bg-bg-card px-3 font-mono text-xs text-fg outline-none transition-colors hover:bg-bg-brand/50"
    >
      <option value="">Все статусы</option>
      <option value="active">Активные</option>
      <option value="archived">В архиве</option>
    </select>
  );
}
