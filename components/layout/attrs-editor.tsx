"use client";

import { useId, useState } from "react";
import { Plus, X } from "lucide-react";
import { attrPresetsFor } from "@/lib/constants";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import ModalBlockLabel from "./modal-block-label";
import SpecParameterInlineEdit from "./inline-parameter";
import { Separator } from "../ui/separator";

/** Вид поля значения: строка «подпись → значение» или карточка с подписью сверху. */
type AttrsEditorVariant = "inline" | "grid";

/** Поле значения в стиле inline-строки модалки: без рамки, фон только на hover/focus. */
const INLINE_INPUT_CLASS =
  "w-full min-w-0 border-0 bg-transparent px-2 font-semibold tabular-nums hover:bg-bg-card focus:bg-bg-card";

/** Кнопка-крестик у строки характеристики. */
const REMOVE_BUTTON_CLASS =
  "flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-md text-fg-muted hover:bg-bg-select";

/**
 * Характеристики материала: пары «ключ → значение».
 *
 * Ключи-пресеты зависят от ТИПА материала (керамогранит → формат, толщина,
 * морозостойкость), а не только от категории: раньше вся «Отделка» получала
 * один набор «Формат / Поверхность / Цвет», включая обои и краску. Если тип не
 * выбран, используется набор категории. Любую свою характеристику можно
 * добавить и удалить — пресеты только подсказывают.
 *
 * Компонент общий для библиотеки материалов и позиций спецификации: в
 * библиотеке это шаблон, который наследует новая позиция. В модалке позиции
 * блок показывается вариантом `inline` — теми же строками «подпись →
 * значение», что и «Описание продукта».
 */
export function AttrsEditor({
  category,
  materialType,
  attrs,
  onChange,
  title = "Характеристики",
  variant = "grid",
  header = true,
}: {
  /** Категория — раздел спецификации (Отделка, Мебель, …). */
  category: string;
  /** Тип материала внутри категории: керамогранит, ламинат, обои, … */
  materialType?: string | null;
  attrs: Record<string, string>;
  onChange: (attrs: Record<string, string>) => void;
  title?: string;
  /**
   * `inline` — значения отдельными строками «подпись → значение», как блок
   * «Описание продукта» в модалке позиции; `grid` — сетка карточек «подпись
   * сверху» для модалок, где все поля в рамках.
   */
  variant?: AttrsEditorVariant;
  /**
   * Рисовать ли свою подпись и разделитель. `false` — когда заголовок и
   * сворачивание даёт внешний блок (например, `ModalSection` в модалке
   * позиции).
   */
  header?: boolean;
}) {
  const [newKey, setNewKey] = useState("");
  /** Префикс для `id` полей: ключи характеристик повторяются между экземплярами. */
  const idPrefix = useId();

  const setValue = (key: string, value: string) => {
    const next = { ...attrs };
    if (value.trim()) next[key] = value;
    else delete next[key];
    onChange(next);
  };

  const removeKey = (key: string) => {
    const next = { ...attrs };
    delete next[key];
    onChange(next);
  };

  const addKey = () => {
    const k = newKey.trim();
    if (!k || k in attrs) return;
    onChange({ ...attrs, [k]: "" });
    setNewKey("");
  };

  const presets = attrPresetsFor(category, materialType);
  const rows = [...new Set([...Object.keys(attrs), ...presets])];

  const addRow = (
    <>
      <Input
        value={newKey}
        onChange={(e) => setNewKey(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            addKey();
          }
        }}
        placeholder="Своя характеристика"
        aria-label="Название характеристики"
        className={cn(
          "h-10 flex-1 outline-none focus:border-fg-brand",
          variant === "inline" && "border-dashed",
        )}
      />
      <Button
        type="button"
        variant="ghost"
        onClick={addKey}
        disabled={!newKey.trim()}
        className="flex h-10 cursor-pointer items-center gap-1.5 px-3 text-[13px] disabled:opacity-40"
      >
        <Plus className="size-3.5" /> Добавить
      </Button>
    </>
  );

  return (
    <>
      {header && (
        <>
          <div className="flex items-baseline justify-between gap-3">
            <ModalBlockLabel>{title}</ModalBlockLabel>
            {materialType ? (
              <span className="truncate font-mono text-[10px] tracking-[.08em] text-fg-muted uppercase">
                {materialType}
              </span>
            ) : null}
          </div>
          <Separator />
        </>
      )}

      {variant === "inline" ? (
        <div className="grid py-1">
          {rows.map((key, i) => {
            const isPreset = presets.includes(key);
            const id = `${idPrefix}-attr-${i}`;
            return (
              <div key={key} className="flex flex-col">
                {/* Разделитель перед каждой строкой, кроме первой, и один в
                    конце — чтобы список читался как блок «Описание продукта». */}
                {i > 0 && <Separator />}
                <SpecParameterInlineEdit label={key} htmlFor={id}>
                  <Input
                    id={id}
                    defaultValue={attrs[key] ?? ""}
                    onBlur={(e) => setValue(key, e.target.value)}
                    onFocus={(e) => e.target.select()}
                    placeholder="—"
                    className={INLINE_INPUT_CLASS}
                  />
                  {!isPreset && (
                    <Button
                      type="button"
                      size="icon-lg"
                      variant="ghost"
                      onClick={() => removeKey(key)}
                      aria-label={`Удалить «${key}»`}
                      className={REMOVE_BUTTON_CLASS}
                    >
                      <X className="size-3.5" />
                    </Button>
                  )}
                </SpecParameterInlineEdit>
              </div>
            );
          })}
          <Separator />
          <div className="flex gap-2 pt-3">{addRow}</div>
        </div>
      ) : (
        <>
          <ul className="grid grid-cols-2 gap-4">
            {rows.map((key) => {
              const isPreset = presets.includes(key);
              return (
                <li key={key} className="flex flex-col gap-2">
                  <span
                    className="w-30 shrink-0 truncate font-mono text-[11px] text-fg-secondary uppercase"
                    title={key}
                  >
                    {key}
                  </span>
                  <div className="flex">
                    <Input
                      defaultValue={attrs[key] ?? ""}
                      onBlur={(e) => setValue(key, e.target.value)}
                      placeholder="—"
                      aria-label={key}
                      className="h-10 min-w-0 flex-1 outline-none focus:border-fg-brand"
                    />
                    {!isPreset && (
                      <Button
                        type="button"
                        size="icon-lg"
                        variant="ghost"
                        onClick={() => removeKey(key)}
                        aria-label={`Удалить «${key}»`}
                        className={REMOVE_BUTTON_CLASS}
                      >
                        <X className="size-3.5" />
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="flex gap-2 border-t border-border-muted pt-3">
            {addRow}
          </div>
        </>
      )}
    </>
  );
}
