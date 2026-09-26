"use client";

import { useId, useRef, useState } from "react";
import { Plus, Undo2, X } from "lucide-react";
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
  "w-full min-w-0 border-0 border-b border-transparent bg-transparent px-2 font-semibold tabular-nums " +
  "hover:border-border-muted hover:bg-bg-card focus:border-transparent focus:bg-bg-card " +
  "group-hover/param:border-border-muted group-hover/param:bg-bg-card";

/** Кнопка-крестик у строки характеристики. */
const REMOVE_BUTTON_CLASS =
  "flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-md text-fg-muted hover:bg-bg-select";

const UNDO_TIMEOUT_MS = 5000;

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
  variant?: AttrsEditorVariant;
  header?: boolean;
}) {
  const [newKey, setNewKey] = useState("");
  /** Префикс для `id` полей: ключи характеристик повторяются между экземплярами. */
  const idPrefix = useId();

  const [pendingRemoval, setPendingRemoval] = useState<{
    key: string;
    value: string;
  } | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setValue = (key: string, value: string) => {
    const next = { ...attrs };
    if (value.trim()) next[key] = value;
    else delete next[key];
    onChange(next);
  };

  const removeKey = (key: string) => {
    const value = attrs[key] ?? "";
    const next = { ...attrs };
    delete next[key];
    onChange(next);

    if (value.trim()) {
      if (undoTimer.current) clearTimeout(undoTimer.current);
      setPendingRemoval({ key, value });
      undoTimer.current = setTimeout(
        () => setPendingRemoval(null),
        UNDO_TIMEOUT_MS,
      );
    }
  };

  const undoRemoval = () => {
    if (!pendingRemoval) return;
    if (undoTimer.current) clearTimeout(undoTimer.current);
    onChange({ ...attrs, [pendingRemoval.key]: pendingRemoval.value });
    setPendingRemoval(null);
  };

  const addKey = () => {
    const k = newKey.trim();
    if (!k || k in attrs) return;
    onChange({ ...attrs, [k]: "" });
    setNewKey("");
  };

  const presets = attrPresetsFor(category, materialType);
  const customKeys = Object.keys(attrs).filter((k) => !presets.includes(k));
  const rows = [...presets, ...customKeys];

  const addRow = (
    <>
      <Input
        value={newKey}
        onChange={(e) => setNewKey(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            addKey();
          } else if (e.key === "Escape") {
            e.preventDefault();
            setNewKey("");
            e.currentTarget.blur();
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

  const undoRow = pendingRemoval && (
    <div className="flex items-center justify-between gap-3 rounded-lg bg-bg-card px-3 py-2 text-[12.5px]">
      <span className="truncate text-fg-muted">
        Удалено «{pendingRemoval.key}»
      </span>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={undoRemoval}
        className="shrink-0 gap-1.5 text-[12.5px] font-medium text-fg-brand"
      >
        <Undo2 className="size-3.5" /> Отменить
      </Button>
    </div>
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
        <div className="grid gap-2 py-1">
          <div className="grid divide-y divide-border-muted/60">
            {rows.map((key, i) => {
              const isPreset = presets.includes(key);
              const id = `${idPrefix}-attr-${i}`;
              return (
                <SpecParameterInlineEdit
                  label={key}
                  htmlFor={id}
                  className={isPreset ? undefined : "text-fg"}
                >
                  <Input
                    id={id}
                    defaultValue={attrs[key] ?? ""}
                    onBlur={(e) => setValue(key, e.target.value)}
                    onFocus={(e) => e.target.select()}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        e.currentTarget.blur();
                      } else if (e.key === "Escape") {
                        e.preventDefault();
                        e.currentTarget.value = attrs[key] ?? "";
                        e.currentTarget.blur();
                      }
                    }}
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
              );
            })}
          </div>
          {undoRow}
          <div className="flex gap-2 border-t border-border-muted/60 pt-3">
            {addRow}
          </div>
        </div>
      ) : (
        <>
          <ul className="grid grid-cols-2 gap-4">
            {rows.map((key) => {
              const isPreset = presets.includes(key);
              return (
                <li key={key} className="flex flex-col gap-2">
                  <span
                    className={cn(
                      "w-30 shrink-0 truncate font-mono text-[11px] uppercase",
                      isPreset ? "text-fg-secondary" : "text-fg",
                    )}
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
          {undoRow}
          <div className="flex gap-2 border-t border-border-muted pt-3">
            {addRow}
          </div>
        </>
      )}
    </>
  );
}
