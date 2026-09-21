"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ALL_CATEGORIES } from "@/lib/constants";
import { cn } from "@/lib/utils";

/**
 * Выбор типа (категории) для мобильной версии — вместо чипсов с
 * drag-to-scroll, которые на узком экране не помещаются.
 *
 * Видимость задаёт вызывающая сторона (`block sm:hidden`), как у соседнего
 * селекта сортировки: сама разметка контрола от брейкпоинта не зависит.
 *
 * Пункт «Все категории» идёт первым — он снимает фильтр, как и первая чипса
 * на десктопе.
 *
 * `modal={false}` и `alignItemWithTrigger={false}` — как в `FilterSelect`:
 * в тулбаре контрол живёт над списком, и модальный попап на touch-устройствах
 * блокировал бы тапы по нему, а эмуляция нативного селекта работает только
 * для мыши. `align="start"` обязателен для триггера во всю ширину: попап
 * шириной с триггер при выравнивании по центру уезжает правым краем за
 * вьюпорт, и мобильный браузер расширяет из-за этого layout viewport.
 */
export function TypeSelectMobile({
  value,
  items,
  onChange,
  className,
}: {
  /** Текущая категория; `ALL_CATEGORIES` — фильтр не задан. */
  value: string;
  items: readonly string[];
  onChange: (category: string) => void;
  className?: string;
}) {
  const options = [ALL_CATEGORIES, ...items];

  return (
    <Select
      items={options.map((label) => ({ label, value: label }))}
      value={value}
      onValueChange={(next) => onChange(next as string)}
      modal={false}
    >
      <SelectTrigger
        aria-label="Тип"
        className={cn(
          "h-10! w-full border-border bg-bg-card font-mono text-xs text-fg-body",
          className,
        )}
      >
        <SelectValue />
      </SelectTrigger>

      <SelectContent
        align="start"
        alignItemWithTrigger={false}
        className="bg-bg-card"
      >
        {options.map((label) => (
          // h-10 — комфортная высота тап-таргета на телефоне.
          <SelectItem key={label} value={label} className="h-10">
            {label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
