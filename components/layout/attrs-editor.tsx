"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import { attrPresetsFor } from "@/lib/constants";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

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
 * библиотеке это шаблон, который наследует новая позиция.
 */
export function AttrsEditor({
  category,
  materialType,
  attrs,
  onChange,
  title = "Характеристики",
}: {
  /** Категория — раздел спецификации (Отделка, Мебель, …). */
  category: string;
  /** Тип материала внутри категории: керамогранит, ламинат, обои, … */
  materialType?: string | null;
  attrs: Record<string, string>;
  onChange: (attrs: Record<string, string>) => void;
  title?: string;
}) {
  const [newKey, setNewKey] = useState("");

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

  return (
    <>
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-mono text-[15px] font-semibold">{title}</span>
        {materialType ? (
          <span className="truncate font-mono text-[10px] tracking-[.08em] text-fg-muted uppercase">
            {materialType}
          </span>
        ) : null}
      </div>
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
                    className="flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-md text-fg-muted hover:bg-bg-select"
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
          className="h-10 flex-1 outline-none focus:border-fg-brand"
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
      </div>
    </>
  );
}
