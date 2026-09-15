"use client";

import { useMemo, useState } from "react";
import { Check, Plus, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ManualItemForm } from "./manual-item-form";
import { ALL_CATEGORIES, TYPE_ORDER, type SpecType } from "@/lib/constants";
import type { MaterialListItem, SpecPickerCompany } from "@/lib/queries";
import { fmt, plural, cn } from "@/lib/utils";
import { SpecItem } from "@/lib/types";
import { ManualSpecItemInput } from "@/lib/validations";
import { useDialogDismissGuard } from "@/components/ui/use-dialog-dismiss-guard";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type SortKey = "default" | "name" | "price" | "brand";

export default function AddModalForm({
  library,
  items,
  companies,
  orgSlug,
  editing,
  parentId = null,
  onClose,
  onAddFromLibrary,
  onFillFromLibrary,
  onAddManual,
  onFillManual,
  variantMode = false,
  variantFor = null,
  forceManual = false,
}: {
  library: MaterialListItem[];
  items: SpecItem[];
  companies: SpecPickerCompany[];
  orgSlug: string;
  editing: SpecItem | null;
  /** Родитель создаваемого субэлемента (null — обычное добавление). */
  parentId?: string | null;
  onClose: () => void;
  onAddFromLibrary: (
    materials: MaterialListItem[],
    parentId: string | null,
  ) => void;
  onFillFromLibrary: (material: MaterialListItem) => void;
  onAddManual: (input: ManualSpecItemInput, parentId: string | null) => void;
  onFillManual: (input: ManualSpecItemInput) => void;
  variantMode?: boolean;
  variantFor?: SpecItem | null;
  forceManual?: boolean;
}) {
  const [mode, setMode] = useState<"catalog" | "manual">(
    forceManual || editing ? "manual" : "catalog",
  );
  const [manualDirty, setManualDirty] = useState(false);
  const [query, setQuery] = useState("");
  const parentItem = parentId
    ? (items.find((i) => i.id === parentId) ?? null)
    : null;
  /**
   * Фильтр каталога по категории. `ALL_CATEGORIES` — «без фильтра»: значение
   * живёт только в состоянии, в URL оно не попадает.
   */
  const [type, setType] = useState<SpecType | typeof ALL_CATEGORIES>(
    variantMode && variantFor
      ? (variantFor.type as SpecType)
      : editing
        ? editing.type
        : (parentItem?.type ?? ALL_CATEGORIES),
  );
  const [sort, setSort] = useState<SortKey>("default");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [hideUsed, setHideUsed] = useState(false);

  /* ── что уже стоит в спецификации ───────────────── */
  const used = useMemo(() => {
    const ids = new Set<string>();
    const articles = new Set<string>();
    for (const i of items) {
      if (i.materialId) ids.add(i.materialId);
      if (i.article) articles.add(i.article.toLowerCase());
    }
    return { ids, articles };
  }, [items]);

  const isUsed = (m: MaterialListItem) =>
    used.ids.has(m.id) ||
    (!!m.article && used.articles.has(m.article.toLowerCase()));

  const usedCount = useMemo(
    () => library.filter(isUsed).length,
    [library, used],
  );

  /* ── типы, реально присутствующие в библиотеке ──── */
  const typesPresent = useMemo(() => {
    const present = new Set(library.map((m) => m.category).filter(Boolean));
    return TYPE_ORDER.filter((t) => present.has(t));
  }, [library]);

  /* ── фильтрация и сортировка ────────────────────── */
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const dir = sortDir === "asc" ? 1 : -1;

    return library
      .filter((m) => {
        if (type !== ALL_CATEGORIES && m.category !== type) return false;
        if (hideUsed && isUsed(m)) return false;
        if (
          q &&
          !`${m.name} ${m.brand ?? ""} ${m.article ?? ""} ${m.product_type ?? ""}`
            .toLowerCase()
            .includes(q)
        )
          return false;
        return true;
      })
      .sort((a, b) => {
        // использованные — всегда вниз, независимо от сортировки
        const byUsed = Number(isUsed(a)) - Number(isUsed(b));
        if (byUsed !== 0) return byUsed;

        switch (sort) {
          case "name":
            return dir * a.name.localeCompare(b.name, "ru");
          case "brand":
            return dir * (a.brand ?? "").localeCompare(b.brand ?? "", "ru");
          case "price":
            return dir * (Number(a.price ?? 0) - Number(b.price ?? 0));
          default:
            return 0;
        }
      });
  }, [library, query, type, hideUsed, sort, sortDir, used]);

  const pickedList = useMemo(
    () => library.filter((m) => picked.has(m.id)),
    [library, picked],
  );
  const pickedSum = pickedList.reduce((s, m) => s + Number(m.price ?? 0), 0);

  const toggle = (m: MaterialListItem) => {
    if (editing) {
      onFillFromLibrary(m);
      return;
    }
    setPicked((prev) => {
      const s = new Set(prev);
      s.has(m.id) ? s.delete(m.id) : s.add(m.id);
      return s;
    });
  };

  const cycleSort = (key: SortKey) => {
    if (key === "default") {
      setSort("default");
      return;
    }
    if (sort === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      return;
    }
    setSort(key);
    setSortDir("asc");
  };

  const { handleOpenChange, showConfirm, confirmDiscard, cancelDiscard } =
    useDialogDismissGuard({
      onClose,
      hasChanges: () =>
        mode === "manual"
          ? manualDirty
          : query.trim().length > 0 || picked.size > 0,
    });

  return (
    <>
      <Dialog open onOpenChange={handleOpenChange}>
        <DialogContent className="flex max-h-[92vh] h-[80svh] flex-col gap-0 overflow-hidden rounded-[22px] bg-bg p-0 sm:max-w-180">
          {/* ── шапка ───────────────────────────────────── */}
          <DialogHeader className="flex-row items-center gap-3 border-b border-border-subtle px-4 py-3">
            <DialogTitle className="flex text-[17px] tracking-[-.01em]">
              {variantMode
                ? `Вариант для ${variantFor?.code ?? "позиции"}`
                : editing
                  ? `Заполнить ${editing.code}`
                  : "Добавить позиции"}
            </DialogTitle>

            <div
              className="flex gap-1 rounded-lg bg-bg-toggle p-1"
              role="tablist"
            >
              {(["catalog", "manual"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  role="tab"
                  aria-selected={mode === m}
                  onClick={() => setMode(m)}
                  className={cn(
                    "rounded-lg px-3.5 py-1.5 text-[13px] font-semibold transition-colors",
                    mode === m
                      ? "bg-bg-accent text-bg"
                      : "text-fg-secondary hover:text-fg",
                  )}
                >
                  {m === "catalog" ? "Из библиотеки" : "Вручную"}
                </button>
              ))}
            </div>
          </DialogHeader>

          {/* ── вручную ─────────────────────────────────── */}
          {mode === "manual" ? (
            <ManualItemForm
              companies={companies}
              orgSlug={orgSlug}
              editing={editing}
              onCancel={onClose}
              variantMode={variantMode}
              variantFor={variantFor}
              onDirtyChange={setManualDirty}
              defaultType={parentItem?.type}
              onSubmit={(d) =>
                editing ? onFillManual(d) : onAddManual(d, parentId)
              }
            />
          ) : (
            <>
              {/* ── фильтры ─────────────────────────────── */}
              <div className="flex-none border-b border-border-subtle px-4 pb-3 pt-3">
                {editing && (
                  <div className="mb-2.5 flex items-center gap-2">
                    <span className="rounded-[7px] bg-bg-accent px-3 py-1 font-mono text-[12px] font-semibold text-bg">
                      {editing.code}
                    </span>
                    <span className="font-mono text-[11px] tracking-[.04em] text-fg-muted">
                      Выберите материал для этой позиции
                    </span>
                  </div>
                )}

                <div className="relative">
                  <Input
                    autoFocus
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    aria-label="Поиск по библиотеке"
                    placeholder="Название, бренд, артикул…"
                    className="h-10 bg-bg-card pr-9 text-[14px]"
                  />
                  {query && (
                    <button
                      type="button"
                      onClick={() => setQuery("")}
                      aria-label="Очистить поиск"
                      className="absolute right-2 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-[7px] bg-bg-clear"
                    >
                      <X className="size-3" />
                    </button>
                  )}
                </div>

                {typesPresent.length > 1 && (
                  <div className="-mx-4 mt-2.5 flex gap-2 overflow-x-auto px-4 pb-0.5">
                    <Chip
                      label={ALL_CATEGORIES}
                      on={type === ALL_CATEGORIES}
                      onClick={() => setType(ALL_CATEGORIES)}
                    />
                    {typesPresent.map((t) => (
                      <Chip
                        key={t}
                        label={t}
                        on={type === t}
                        onClick={() => setType(t)}
                      />
                    ))}
                  </div>
                )}

                <div className="mt-2 flex items-center gap-2">
                  <span className="flex-none font-mono text-[10px] uppercase tracking-widest text-fg-dim">
                    Сорт.
                  </span>
                  <div className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto pb-0.5">
                    {(
                      [
                        { key: "default", label: "По каталогу" },
                        { key: "name", label: "Название" },
                        { key: "price", label: "Цена" },
                        { key: "brand", label: "Бренд" },
                      ] as const
                    ).map((d) => (
                      <Chip
                        key={d.key}
                        label={d.label}
                        on={sort === d.key}
                        size="sm"
                        suffix={
                          sort === d.key && d.key !== "default"
                            ? sortDir === "desc"
                              ? "↓"
                              : "↑"
                            : undefined
                        }
                        onClick={() => cycleSort(d.key)}
                      />
                    ))}
                  </div>
                  {usedCount > 0 && (
                    <Chip
                      label={`Скрыть · ${usedCount}`}
                      on={hideUsed}
                      size="sm"
                      onClick={() => setHideUsed((v) => !v)}
                    />
                  )}
                </div>
              </div>

              {/* ── карточки ────────────────────────────── */}
              <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
                {visible.length === 0 ? (
                  <div className="py-14 text-center">
                    <p className="text-[13.5px] text-fg-muted">
                      {library.length === 0
                        ? "Библиотека материалов пуста."
                        : "Ничего не найдено — измените запрос или фильтр."}
                    </p>
                    <button
                      type="button"
                      onClick={() => setMode("manual")}
                      className="mt-3 text-[13.5px] font-semibold text-fg-brand underline underline-offset-4"
                    >
                      Создать материал вручную
                    </button>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {visible.map((m) => {
                      const on = picked.has(m.id);
                      return (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => toggle(m)}
                          aria-pressed={on}
                          className={cn(
                            "flex w-full items-center gap-3 rounded-lg border p-2 text-left transition-colors",
                            on
                              ? "border-fg-brand bg-bg-brand/40"
                              : "border-border-muted bg-bg-card hover:border-border",
                            isUsed(m) && "bg-bg-green-light",
                          )}
                        >
                          <span
                            className="size-16 flex-none rounded-sm border border-border-placeholder bg-cover bg-center"
                            style={
                              m.imageUrl
                                ? { backgroundImage: `url(${m.imageUrl})` }
                                : {
                                    background:
                                      "repeating-linear-gradient(135deg,#e7e1d6,#e7e1d6 5px,#efe9df 5px,#efe9df 10px)",
                                  }
                            }
                          />
                          <span className="min-w-0 flex-1">
                            <span className="flex items-baseline justify-between gap-2">
                              <span className="truncate text-[14px] font-bold tracking-[-.01em]">
                                {m.name}
                              </span>
                              <span className="flex-none text-[13px] font-bold tabular-nums">
                                {m.price ? fmt(Number(m.price)) : "—"} ₽
                                {m.unit && (
                                  <span className="text-[10px] font-medium text-fg-muted">
                                    /{m.unit}
                                  </span>
                                )}
                              </span>
                            </span>
                            <span className="mt-0.5 block truncate font-mono text-[10px] uppercase tracking-[.04em] text-fg-muted">
                              {[m.brand, m.product_type, m.article]
                                .filter(Boolean)
                                .join(" · ") || "—"}
                              {isUsed(m) && (
                                <span className="text-fg-green">
                                  {" "}
                                  · в спецификации
                                </span>
                              )}
                            </span>
                          </span>
                          {!editing && (
                            <span
                              className={cn(
                                "flex size-5 flex-none items-center justify-center rounded border",
                                on
                                  ? "border-fg-brand bg-fg-brand text-bg"
                                  : "border-border-muted",
                              )}
                            >
                              {on && <Check className="size-3" />}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* ── подвал ──────────────────────────────── */}
              {!editing && (
                <div className="flex-none border-t border-border-subtle p-4">
                  {pickedList.length > 0 && (
                    <div className="mb-2.5 flex gap-2 overflow-x-auto pb-1">
                      {pickedList.map((m) => (
                        <span
                          key={m.id}
                          className="inline-flex flex-none items-center gap-2 rounded-full border border-border-chips bg-bg-selected py-1.5 pl-3 pr-2 text-[12.5px] font-semibold"
                        >
                          {m.name}
                          <button
                            type="button"
                            onClick={() =>
                              setPicked((p) => {
                                const s = new Set(p);
                                s.delete(m.id);
                                return s;
                              })
                            }
                            aria-label={`Убрать ${m.name}`}
                            className="flex size-4 items-center justify-center rounded-full bg-bg-clear"
                          >
                            <X className="size-2.5" />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}

                  <div className="flex items-center gap-3">
                    <p className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-fg-secondary">
                      {picked.size > 0 ? (
                        <>
                          {picked.size}{" "}
                          {plural(picked.size, "позиция", "позиции", "позиций")}{" "}
                          · {fmt(pickedSum)} ₽ ·{" "}
                          <button
                            type="button"
                            onClick={() => setPicked(new Set())}
                            className="underline"
                          >
                            сбросить
                          </button>
                        </>
                      ) : (
                        "Выберите материалы"
                      )}
                    </p>
                    <Button
                      onClick={() => onAddFromLibrary(pickedList, parentId)}
                      disabled={picked.size === 0}
                      size="lg"
                    >
                      <Plus className="size-4" />
                      {picked.size > 0
                        ? `Добавить · ${picked.size}`
                        : "Добавить"}
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={showConfirm}
        onOpenChange={(v) => !v && cancelDiscard()}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Несохранённые изменения</AlertDialogTitle>
            <AlertDialogDescription>
              Вы начали выбор или заполнение полей. Хотите закрыть окно? Все
              введённые значения будут потеряны.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel size="lg" onClick={cancelDiscard}>
              Остаться
            </AlertDialogCancel>
            <AlertDialogAction
              size="lg"
              onClick={confirmDiscard}
              variant="destructive"
            >
              Закрыть без сохранения
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/* ---------------------------------------------------------------- */

function Chip({
  label,
  on,
  size = "md",
  suffix,
  onClick,
}: {
  label: string;
  on: boolean;
  size?: "sm" | "md";
  suffix?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={cn(
        "flex flex-none items-center gap-1.5 whitespace-nowrap rounded-full border font-semibold transition-colors",
        size === "sm" ? "px-2.5 py-1 text-[12px]" : "px-3.5 py-2 text-[13px]",
        on
          ? "border-fg-brand bg-bg-accent text-bg"
          : "border-border-muted text-fg-secondary hover:border-border",
      )}
    >
      {label}
      {suffix && (
        <span className="font-mono text-[10px] leading-none">{suffix}</span>
      )}
    </button>
  );
}
