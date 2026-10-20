"use client";

import { useSearchParams } from "next/navigation";
import { useMaterialsUrl } from "@/hooks/use-materials-url";
import { isMaterialsArchiveStatus } from "@/lib/materials/filters";
import { cn } from "@/lib/utils";
import { Heart } from 'lucide-react';

/**
 * Переключатель «Избранное» в ряду фильтров библиотеки.
 *
 * Кнопка-переключатель, а не селект: у фильтра два состояния, и включённое
 * обязано быть видно без наведения — отсюда заливка и `aria-pressed`, как у
 * соседних чипсов. Параметр `favorite` живёт в адресе (`1` — включён), поэтому
 * перезагрузка и «назад» возвращают тот же список.
 *
 * В режиме «Архив» переключатель не рендерится: там нельзя управлять отметками,
 * а включённый фильтр оставил бы список пустым без видимой причины. Параметр в
 * такой адрес не попадает (`updateMaterialsSearchParams` снимает его), а старый
 * адрес сервер трактует как «фильтр выключен» (`parseMaterialsFilters`).
 */
export function MaterialsFavoriteToggle({
  className,
}: {
  className?: string;
}) {
  const searchParams = useSearchParams();
  const { update } = useMaterialsUrl();
  const favorite = searchParams.get("favorite") === "1";

  if (isMaterialsArchiveStatus(searchParams.get("status"))) return null;

  return (
    <button
      type="button"
      aria-pressed={favorite}
      onClick={() => update({ favorite: !favorite })}
      className={cn(
        "flex h-10 shrink-0 items-center justify-start rounded-lg border px-3 font-mono text-xs transition-colors",
        favorite
          ? "border-fg-brand bg-bg-brand font-semibold text-fg"
          : "border-border bg-bg-card text-fg-body hover:bg-bg-brand/50",
        className,
      )}
    >
      <Heart
        className={cn(
          "size-4 transition-colors",
          favorite ? "fill-fg text-fg" : "text-fg-body",
        )}
      />
    </button>
  );
}
