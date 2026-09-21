"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

/**
 * Высота важна: в базовом триггере она задана через `data-[size=default]:h-8`,
 * и перебить её можно только `!` (тот же приём в диалоге материала).
 *
 * `min-w-40` держит ширину контрола стабильной: `w-fit` у триггера подстраивался
 * бы под длину выбранной подписи, и строка фильтров прыгала бы при выборе.
 */
const TRIGGER_CLASS =
  "h-10! min-w-40 border-border bg-bg-card font-mono text-xs hover:bg-bg-brand/50";

export type FilterSelectOption<T extends string> = {
  label: string;
  /** `null` — пункт «без фильтра» (base-ui трактует его как «ничего не выбрано»). */
  value: T | null;
};

/**
 * Общий селект фильтров и сортировки для тулбаров списков: библиотека
 * материалов (производитель, статус, сортировка) и контакты (сортировка).
 *
 * Триггер, попап и подписи пунктов обязаны совпадать у всех контролов, поэтому
 * стили и `items` живут здесь, а не дублируются по файлам. `items` нужен
 * base-ui, чтобы `SelectValue` показывал подпись выбранного пункта: у пункта
 * «без фильтра» значение `null`, и без `items` триггер показал бы пустоту
 * вместо подписи.
 */
export function FilterSelect<T extends string>({
  ariaLabel,
  placeholder,
  options,
  value,
  onChange,
  disabled,
  side = "bottom",
  className,
}: {
  ariaLabel: string;
  /** Подпись при `value === null` (в пустом списке — причина пустоты). */
  placeholder: string;
  options: readonly FilterSelectOption<T>[];
  value: T | null;
  onChange: (value: T | null) => void;
  disabled?: boolean;
  /** Сторона открытия. В нижнем drawer'е — `top`: под триггером места нет. */
  side?: "top" | "bottom";
  className?: string;
}) {
  const items = options.map((option) => ({
    label: option.label,
    value: option.value,
  }));

  return (
    <Select
      items={items}
      value={value}
      onValueChange={(next) => onChange((next as T | null) ?? null)}
      disabled={disabled}
      // Якорный поп-ап ничего не должен лочить: base-ui включает свой
      // anchored-scroll-lock при `alignItemWithTrigger || modal`
      // (SelectPositioner → useAnchoredPopupScrollLock). Внутри уже
      // залоченного модального drawer'а это меняет overflow и компенсирует
      // скроллбар у документа и у скролл-контейнера drawer'а, из-за чего при
      // открытии весь экран «уезжает». Отключаем оба флага: модальность и
      // скролл-лок уже обеспечивает сам drawer.
      modal={false}
    >
      <SelectTrigger
        aria-label={ariaLabel}
        className={cn(TRIGGER_CLASS, className)}
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>

      {/* `align="start"` — обязателен: попап шириной с триггер (`w-full` в
          drawer'е) при выравнивании по центру уезжает правым краем за вьюпорт,
          а мобильный браузер расширяет из-за этого layout viewport и «улетает»
          вместе с fixed-drawer'ом. По левому краю попап всегда внутри экрана.
          `alignItemWithTrigger={false}` — без эмуляции нативного селекта: она
          работает только для мыши, а в нижнем drawer'е места под триггером нет. */}
      <SelectContent
        side={side}
        align="start"
        alignItemWithTrigger={false}
        className="bg-bg-card"
      >
        {options.map((option) => (
          <SelectItem key={String(option.value)} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
