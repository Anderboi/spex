"use client";

import { TYPE_ORDER, UNIT_OPTIONS } from "@/lib/constants";
import { SpecItem, DraftItem } from "@/lib/types";
import { fmt, catKey } from "@/lib/utils";

// ─── AddModal ────────────────────────────────────────────────────
interface AddModalProps {
  editId: string | null;
  addMode: "catalog" | "manual";
  setAddMode: (m: "catalog" | "manual") => void;
  draft: DraftItem;
  setDraft: (d: DraftItem) => void;
  onClose: () => void;
  onSubmit: () => void;
  catQueryInput: string;
  setCatQueryInput: (v: string) => void;
  setCatQuery: (v: string) => void;
  catDebounce: React.MutableRefObject<
    ReturnType<typeof setTimeout> | undefined
  >;
  catType: string;
  setCatType: (t: string) => void;
  catSort: string;
  setCatSort: (s: string) => void;
  catSortDir: "asc" | "desc";
  setCatSortDir: (d: "asc" | "desc") => void;
  catHideInSpec: boolean;
  setCatHideInSpec: (v: boolean) => void;
  catSelected: Record<string, boolean>;
  toggleCat: (key: string) => void;
  catSorted: any[];
  catInSpec: (c: any) => boolean;
  catInSpecCount: number;
  catSelCount: number;
  catSelSumStr: string;
  addFromCatalog: () => void;
  fillItem: SpecItem | null | undefined;
  catTypesPresent: string[];
  catSelectedList: any[];
  setCatSelected: (v: Record<string, boolean>) => void;
  prefixOf: (code: string) => string;
}

export function AddModal({
  editId,
  addMode,
  setAddMode,
  draft,
  setDraft,
  onClose,
  onSubmit,
  catQueryInput,
  setCatQueryInput,
  setCatQuery,
  catDebounce,
  catType,
  setCatType,
  catSort,
  setCatSort,
  catSortDir,
  setCatSortDir,
  catHideInSpec,
  setCatHideInSpec,
  catSelected,
  toggleCat,
  catSorted,
  catInSpec,
  catInSpecCount,
  catSelCount,
  catSelSumStr,
  addFromCatalog,
  fillItem,
  catTypesPresent,
  catSelectedList,
  setCatSelected,
  prefixOf,
}: AddModalProps) {
  const canSubmit =
    !!draft.name.trim() &&
    (editId ? true : parseInt(String(draft.price).replace(/\D/g, "")) > 0);

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-60 flex items-start justify-center overflow-y-auto"
      style={{
        background: "rgba(27,26,23,.42)",
        padding: "clamp(12px,6vh,80px) 16px",
      }}
    >
      <div
        onClick={(e: React.MouseEvent) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        data-modal="add"
        tabIndex={-1}
        className="w-full max-w-140 max-h-[90vh] flex flex-col bg-bg rounded-[22px] overflow-hidden outline-none"
        style={{ boxShadow: "0 30px 80px rgba(27,26,23,.3)" }}
      >
        <div className="flex-none flex items-center justify-between py-5 px-6 pb-4 border-b border-border-subtle">
          <span className="text-[19px] font-bold tracking-[-.01em]">
            {editId ? "Заполнить позицию" : "Новый материал"}
          </span>
          <button
            onClick={onClose}
            type="button"
            aria-label="Закрыть"
            className="bg-none border-none cursor-pointer text-[20px] text-fg leading-none p-1"
          >
            ✕
          </button>
        </div>

        <div className="flex-none px-6 pt-3.5">
          <div className="flex gap-1 bg-bg-toggle rounded-xl p-1">
            <button
              onClick={() => setAddMode("catalog")}
              className="flex-1 py-2.5 border-none rounded-[9px] font-sans text-[14px] font-semibold cursor-pointer"
              style={{
                background: addMode === "catalog" ? "#1b1a17" : "transparent",
                color: addMode === "catalog" ? "#f3efe7" : "#46423a",
              }}
            >
              Из каталога
            </button>
            <button
              onClick={() => setAddMode("manual")}
              className="flex-1 py-2.5 border-none rounded-[9px] font-sans text-[14px] font-semibold cursor-pointer"
              style={{
                background: addMode === "manual" ? "#1b1a17" : "transparent",
                color: addMode === "manual" ? "#f3efe7" : "#46423a",
              }}
            >
              Вручную
            </button>
          </div>
        </div>

        {addMode === "manual" && (
          <>
            <div className="flex-1 min-h-0 overflow-y-auto py-5.5 px-6">
              <div className="font-mono text-[10px] tracking-[.08em] uppercase text-fg-muted">
                Наименование
              </div>
              <input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="Напр. Rome Vein"
                className="w-full h-[46px] mt-[7px] px-[14px] border border-border rounded-[11px] bg-bg-card text-[15px] outline-none"
              />
              <div className="flex gap-3 mt-4">
                <div className="flex-1">
                  <div className="font-mono text-[10px] tracking-[.08em] uppercase text-fg-muted">
                    Бренд
                  </div>
                  <input
                    value={draft.brand}
                    onChange={(e) =>
                      setDraft({ ...draft, brand: e.target.value })
                    }
                    placeholder="ABK"
                    className="w-full h-[46px] mt-[7px] px-[14px] border border-border rounded-[11px] bg-bg-card text-[15px] outline-none"
                  />
                </div>
                <div className="flex-1">
                  <div className="font-mono text-[10px] tracking-[.08em] uppercase text-fg-muted">
                    Тип
                  </div>
                  <select
                    value={draft.type}
                    onChange={(e) =>
                      setDraft({ ...draft, type: e.target.value })
                    }
                    className="w-full h-[46px] mt-[7px] px-3 border border-border rounded-[11px] bg-bg-card text-[15px] font-sans text-fg outline-none"
                  >
                    {TYPE_ORDER.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="mt-4">
                <div className="font-mono text-[10px] tracking-[.08em] uppercase text-fg-muted">
                  Спецификация
                </div>
                <input
                  value={draft.spec}
                  onChange={(e) => setDraft({ ...draft, spec: e.target.value })}
                  placeholder="Керамогранит, 120×278"
                  className="w-full h-[46px] mt-[7px] px-[14px] border border-border rounded-[11px] bg-bg-card text-[15px] outline-none"
                />
              </div>
              <div className="flex gap-3 mt-4">
                <div className="w-[90px]">
                  <div className="font-mono text-[10px] tracking-[.08em] uppercase text-fg-muted">
                    Кол-во
                  </div>
                  <input
                    value={draft.qty}
                    onChange={(e) =>
                      setDraft({ ...draft, qty: e.target.value })
                    }
                    className="w-full h-[46px] mt-[7px] px-[14px] border border-border rounded-[11px] bg-bg-card text-[15px] font-mono outline-none"
                  />
                </div>
                <div className="w-20">
                  <div className="font-mono text-[10px] tracking-[.08em] uppercase text-fg-muted">
                    Ед.
                  </div>
                  <select
                    value={draft.unit}
                    onChange={(e) =>
                      setDraft({ ...draft, unit: e.target.value })
                    }
                    className="w-full h-[46px] mt-[7px] px-[10px] border border-border rounded-[11px] bg-bg-card text-[15px] font-mono text-fg outline-none"
                  >
                    {UNIT_OPTIONS.map((u) => (
                      <option key={u} value={u}>
                        {u}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex-1">
                  <div className="font-mono text-[10px] tracking-[.08em] uppercase text-fg-muted">
                    Цена / шт, ₽
                  </div>
                  <input
                    value={draft.price}
                    onChange={(e) =>
                      setDraft({ ...draft, price: e.target.value })
                    }
                    placeholder="6500"
                    className="w-full h-[46px] mt-[7px] px-[14px] border border-border rounded-[11px] bg-bg-card text-[15px] font-mono outline-none"
                  />
                </div>
              </div>
            </div>
            <div className="flex-none flex gap-[10px] py-4 px-6 border-t border-border-subtle">
              <button
                onClick={onClose}
                className="flex-none bg-transparent border border-border-muted text-fg-body rounded-[12px] py-[14px] px-5 text-[14px] font-semibold cursor-pointer"
              >
                Отмена
              </button>
              <button
                onClick={onSubmit}
                className="flex-1 border-none rounded-xl py-[14px] text-[15px] font-semibold"
                style={{
                  background: canSubmit ? "#1b1a17" : "#bcb7ab",
                  color: "#f3efe7",
                  cursor: canSubmit ? "pointer" : "not-allowed",
                }}
              >
                {editId ? "Сохранить позицию" : "Добавить материал"}
              </button>
            </div>
          </>
        )}

        {addMode === "catalog" && (
          <>
            <div className="flex-none px-6 pt-[14px]">
              {editId && fillItem && (
                <div className="flex items-center gap-[10px] mb-3">
                  <span className="font-mono text-[12px] font-semibold bg-bg-accent text-bg py-[5px] px-[11px] rounded-[7px]">
                    {fillItem.code}
                  </span>
                  <span className="font-mono text-[11px] tracking-[.04em] text-fg-muted">
                    Выберите материал для этой позиции
                  </span>
                </div>
              )}
              <div className="flex items-center gap-3 bg-bg-card border border-border rounded-xl px-[14px] h-[46px]">
                <div className="size-3.5 border-[1.6px] border-fg-icon rounded-full relative flex-none">
                  <div className="absolute w-[6px] h-[1.6px] bg-fg-icon right-[-4px] bottom-0 rotate-45 origin-left"></div>
                </div>
                <input
                  value={catQueryInput}
                  onChange={(e) => {
                    const v = e.target.value;
                    setCatQueryInput(v);
                    clearTimeout(catDebounce.current);
                    catDebounce.current = setTimeout(() => setCatQuery(v), 120);
                  }}
                  aria-label="Поиск по каталогу"
                  placeholder="Название, бренд, артикул…"
                  className="flex-1 border-none bg-transparent text-[15px] text-fg min-w-0 outline-none"
                />
                {catQueryInput.trim().length > 0 && (
                  <button
                    onClick={() => {
                      setCatQueryInput("");
                      setCatQuery("");
                    }}
                    type="button"
                    aria-label="Очистить"
                    className="flex-none w-6 h-6 rounded-[7px] border-none bg-bg-clear text-fg-body cursor-pointer text-[13px]"
                  >
                    ✕
                  </button>
                )}
              </div>
              <div className="flex gap-[7px] mt-3 overflow-x-auto pb-[2px]">
                {catTypesPresent.map((t: string) => (
                  <button
                    key={t}
                    onClick={() => setCatType(t)}
                    className="flex-none py-2 px-[14px] rounded-full font-sans text-[13px] font-semibold cursor-pointer whitespace-nowrap"
                    style={{
                      background: catType === t ? "#1b1a17" : "transparent",
                      color: catType === t ? "#f3efe7" : "#46423a",
                      border:
                        catType === t
                          ? "1px solid #1b1a17"
                          : "1px solid #d9d3c6",
                    }}
                  >
                    {t}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-[9px] mt-[11px]">
                <span className="flex-none font-mono text-[10px] tracking-[.1em] uppercase text-fg-dim">
                  Сорт.
                </span>
                <div className="flex gap-[7px] overflow-x-auto pb-[2px]">
                  {[
                    { key: "default", label: "По каталогу" },
                    { key: "name", label: "Название" },
                    { key: "price", label: "Цена" },
                    { key: "brand", label: "Производитель" },
                  ].map((def) => {
                    const on = catSort === def.key;
                    return (
                      <button
                        key={def.key}
                        onClick={() => {
                          if (def.key === "default") setCatSort("default");
                          else if (catSort === def.key)
                            setCatSortDir(
                              catSortDir === "asc" ? "desc" : "asc",
                            );
                          else {
                            setCatSort(def.key);
                            setCatSortDir("asc");
                          }
                        }}
                        className="flex-none flex items-center gap-1 py-2 px-3 rounded-full font-sans text-[12.5px] font-semibold cursor-pointer whitespace-nowrap"
                        style={{
                          background: on ? "#1b1a17" : "transparent",
                          color: on ? "#f3efe7" : "#46423a",
                          border: on
                            ? "1px solid #1b1a17"
                            : "1px solid #d9d3c6",
                        }}
                      >
                        {def.label}
                        {on && def.key !== "default" && (
                          <span className="font-mono text-[11px] leading-none">
                            {catSortDir === "desc" ? "↓" : "↑"}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
              {(catInSpecCount > 0 || catHideInSpec) && (
                <div className="flex mt-[10px]">
                  <button
                    onClick={() => setCatHideInSpec(!catHideInSpec)}
                    className="inline-flex items-center gap-2 py-2 pl-[10px] pr-3 rounded-full cursor-pointer font-sans text-[12.5px] font-semibold whitespace-nowrap"
                    style={{
                      background: catHideInSpec ? "#eef0e6" : "transparent",
                      color: "#1b1a17",
                      border: catHideInSpec
                        ? "1px solid #1b1a17"
                        : "1px solid #d9d3c6",
                    }}
                  >
                    <span
                      className="flex-none w-4 h-4 rounded-[5px] flex items-center justify-center text-[11px] leading-none"
                      style={{
                        border: `1.6px solid ${catHideInSpec ? "#1b1a17" : "#c9c2b3"}`,
                        background: catHideInSpec ? "#1b1a17" : "transparent",
                        color: "#f3efe7",
                      }}
                    >
                      {catHideInSpec ? "✓" : ""}
                    </span>
                    Скрыть добавленные · {catInSpecCount}
                  </button>
                </div>
              )}
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto px-6 pt-[14px] pb-2">
              {catSorted.length === 0 && (
                <div className="text-center py-9 px-3 font-mono text-[12px] text-fg-dim">
                  Ничего не найдено — измените запрос или фильтр
                </div>
              )}
              {catSorted.map((c: any) => {
                const key = catKey(c);
                const on = !!catSelected[key];
                return (
                  <button
                    key={key}
                    onClick={() => toggleCat(key)}
                    className="w-full text-left flex flex-col gap-[9px] rounded-[14px] p-[13px] mb-[10px] cursor-pointer font-sans"
                    style={{
                      border: `1px solid ${on ? "#1b1a17" : "#e6e1d5"}`,
                      background: on ? "#eef0e6" : "#faf8f3",
                    }}
                  >
                    <div className="flex items-start gap-[11px]">
                      <span
                        className="flex-none w-[52px] h-[52px] rounded-[9px] border border-border-placeholder"
                        style={{
                          background:
                            "repeating-linear-gradient(135deg,#e7e1d6,#e7e1d6 5px,#efe9df 5px,#efe9df 10px)",
                        }}
                      ></span>
                      <span className="flex-1 min-w-0 pr-[26px]">
                        <span className="block text-[14.5px] font-bold tracking-[-.01em] leading-[1.2]">
                          {c.name}
                        </span>
                        <span className="block font-mono text-[10px] tracking-[.06em] uppercase text-fg-muted mt-[3px]">
                          {c.brand}
                        </span>
                        {catInSpec(c) && (
                          <span className="inline-flex items-center gap-[5px] mt-[7px] font-mono text-[9px] tracking-[.06em] uppercase text-fg-green bg-bg-green-light border border-border-accent rounded-full py-[3px] px-2">
                            <span className="w-[5px] h-[5px] rounded-full bg-bg-green"></span>
                            в спецификации
                          </span>
                        )}
                      </span>
                    </div>
                    <span className="block text-[12px] text-fg-secondary leading-[1.35]">
                      {c.spec}
                    </span>
                    <span className="flex items-baseline justify-between mt-[2px]">
                      <span className="font-mono text-[9px] tracking-[.06em] uppercase text-fg-dim">
                        {c.type}
                      </span>
                      <span className="font-sans text-[14px] font-bold">
                        {fmt(c.price)} ₽
                        <span className="text-[10px] font-medium text-fg-muted">
                          /{c.unit}
                        </span>
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="flex-none px-6 pb-[14px] pt-3 border-t border-border-subtle">
              {catSelCount > 0 && !editId && (
                <div className="flex gap-[7px] overflow-x-auto pb-[10px]">
                  {catSelectedList.map((c: any) => (
                    <span
                      key={catKey(c)}
                      className="flex-none inline-flex items-center gap-[7px] bg-bg-selected border border-border-chips rounded-full py-[6px] pl-3 pr-2 text-[12.5px] font-semibold text-fg whitespace-nowrap"
                    >
                      {c.name}
                      <span
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleCat(catKey(c));
                        }}
                        className="cursor-pointer w-[17px] h-[17px] rounded-full bg-[#dfe3d3] text-fg-body inline-flex items-center justify-center text-[11px] leading-none"
                      >
                        ✕
                      </span>
                    </span>
                  ))}
                </div>
              )}
              <div className="flex items-center gap-3">
                <div className="flex-1 min-w-0 font-mono text-[11.5px] text-fg-secondary truncate">
                  {catSelCount > 0 && (
                    <span>
                      {catSelCount} · {catSelSumStr} ₽ ·{" "}
                      <span
                        onClick={() => {
                          setCatSelected({});
                        }}
                        className="cursor-pointer underline"
                      >
                        сбросить
                      </span>
                    </span>
                  )}
                </div>
                <button
                  onClick={addFromCatalog}
                  className="flex-none border-none rounded-[12px] py-[14px] px-[22px] font-sans text-[15px] font-semibold"
                  style={{
                    background: catSelCount > 0 ? "#1b1a17" : "#bcb7ab",
                    color: "#f3efe7",
                    cursor: catSelCount > 0 ? "pointer" : "not-allowed",
                  }}
                >
                  {editId
                    ? catSelCount > 0
                      ? "Заполнить позицию"
                      : "Выберите материал"
                    : catSelCount > 0
                      ? `Добавить выбранное · ${catSelCount}`
                      : "Выберите материалы"}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── DeleteModal ─────────────────────────────────────────────────
interface DeleteModalProps {
  item: SpecItem;
  items: SpecItem[];
  deleteMode: string | null;
  setDeleteMode: (m: string | null) => void;
  onClose: () => void;
  onDeleteFull: () => void;
  onReplaceWithMark: (targetId: string) => void;
  onCreateReplace: () => void;
  onClear: () => void;
  prefixOf: (code: string) => string;
}

export function DeleteModal({
  item,
  items,
  deleteMode,
  setDeleteMode,
  onClose,
  onDeleteFull,
  onReplaceWithMark,
  onCreateReplace,
  onClear,
  prefixOf,
}: DeleteModalProps) {
  const rooms = item.rooms || [];
  const candidates = items
    .filter(
      (it: SpecItem) =>
        it.type === item.type && it.id !== item.id && !it.isPlaceholder,
    )
    .map((it: SpecItem) => ({
      code: it.code,
      name: it.name,
      brand: it.brand,
      onPick: () => onReplaceWithMark(it.id),
    }));
  const replacing = deleteMode === "replace";

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-65 flex items-start justify-center overflow-y-auto"
      style={{
        background: "rgba(27,26,23,.42)",
        padding: "clamp(12px,5vh,64px) 16px",
      }}
    >
      <div
        onClick={(e: React.MouseEvent) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        data-modal="delete"
        tabIndex={-1}
        className="w-full max-w-[496px] bg-bg rounded-[22px] overflow-hidden outline-none"
        style={{ boxShadow: "0 30px 80px rgba(27,26,23,.3)" }}
      >
        <div className="flex items-center justify-between py-5 px-6 border-b border-border-subtle">
          <div className="flex items-center gap-3">
            <span className="font-mono text-[13px] font-semibold bg-bg-accent text-bg py-[5px] px-[11px] rounded-[7px]">
              {item.code}
            </span>
            <span className="text-[18px] font-bold tracking-[-.01em]">
              Удаление марки
            </span>
          </div>
          <button
            onClick={onClose}
            type="button"
            aria-label="Закрыть"
            className="bg-none border-none cursor-pointer text-[20px] text-fg leading-none p-1"
          >
            ✕
          </button>
        </div>
        <div className="py-6 px-6">
          <div className="text-[15px] text-fg-body leading-[1.4]">
            {item.name || "Марка " + item.code}{" "}
            <span className="font-mono text-[11.5px] text-fg-muted">
              · {item.type}
            </span>
          </div>
          {rooms.length > 0 && (
            <div className="mt-3 bg-bg-gold border border-border-gold rounded-[13px] py-3 px-4">
              <div className="font-mono text-[10px] tracking-[.08em] uppercase text-fg-gold">
                Назначена в {rooms.length} помещениях
              </div>
              <div className="flex flex-wrap gap-2 mt-2">
                {rooms.map((r: string) => (
                  <span
                    key={r}
                    className="text-[12.5px] font-medium bg-bg-white border border-border-gold text-fg-gold-text rounded-full py-1 px-3"
                  >
                    {r}
                  </span>
                ))}
              </div>
            </div>
          )}
          {rooms.length === 0 && (
            <div className="mt-6 bg-bg-card border border-border rounded-[13px] py-3 px-4 text-[13px] text-fg-muted">
              Назначений в помещениях нет — марку можно безопасно удалить.
            </div>
          )}

          {!replacing ? (
            <div className="flex flex-col gap-2 mt-4">
              <div
                onClick={onDeleteFull}
                className="border border-border-red-light bg-bg-delete rounded-[14px] p-4 px-4 cursor-pointer"
              >
                <div className="text-[15.5px] font-semibold text-fg-red">
                  🗑 Удалить полностью
                </div>
                <div className="text-[13px] text-fg-light-text mt-1 leading-[1.45]">
                  Марка удаляется безвозвратно. Последующие марки с префиксом «
                  {prefixOf(item.code)}» сместятся вверх.
                </div>
              </div>
              <div
                onClick={() => setDeleteMode("replace")}
                className="border border-border bg-bg-card rounded-[14px] p-[15px] px-4 cursor-pointer flex items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <div className="text-[15.5px] font-semibold">
                    🔄 Заменить на другую марку
                  </div>
                  <div className="text-[13px] text-fg-light-text mt-[5px] leading-[1.45]">
                    Перенести назначения на другую марку категории «{item.type}
                    », затем удалить эту.
                  </div>
                </div>
                <span className="flex-none text-fg-muted text-[18px]">→</span>
              </div>
              <div
                onClick={onClear}
                className="border border-border bg-bg-card rounded-[14px] p-[15px] px-4 cursor-pointer"
              >
                <div className="text-[15.5px] font-semibold">
                  Очистить содержимое
                </div>
                <div className="text-[13px] text-fg-light-text mt-[5px] leading-[1.45]">
                  Материал обнуляется, на месте останется пустая марка{" "}
                  {item.code}.
                </div>
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-[10px] mt-[18px]">
                <span
                  onClick={() => setDeleteMode(null)}
                  className="cursor-pointer text-[18px] text-fg-muted"
                >
                  ←
                </span>
                <span className="font-mono text-[11px] tracking-[.08em] uppercase text-fg-muted">
                  Выберите марку-приёмник
                </span>
              </div>
              {candidates.length > 0 && (
                <div className="flex flex-col gap-2 mt-[13px]">
                  {candidates.map((c: any) => (
                    <div
                      key={c.code}
                      onClick={c.onPick}
                      className="flex items-center gap-[13px] border border-border bg-bg-card rounded-[13px] py-3 px-[14px] cursor-pointer"
                    >
                      <span className="font-mono text-[12px] font-semibold bg-[#efe9dc] text-fg py-1 px-[9px] rounded-[6px] flex-none">
                        {c.code}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="text-[15px] font-semibold truncate">
                          {c.name}
                        </div>
                        <div className="font-mono text-[10.5px] text-fg-muted mt-[2px]">
                          {c.brand}
                        </div>
                      </div>
                      <span className="flex-none text-fg-muted text-[16px]">
                        →
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {candidates.length === 0 && (
                <>
                  <div className="mt-[13px] text-[13.5px] text-fg-light-text leading-[1.45]">
                    Подходящих марок категории «{item.type}» нет.
                  </div>
                  <div
                    onClick={onCreateReplace}
                    className="mt-3 flex items-center gap-[11px] border-[1.5px] border-dashed border-border-dash-dots rounded-[13px] p-[14px] cursor-pointer text-fg-body"
                  >
                    <span className="w-[26px] h-[26px] rounded-[7px] border-[1.5px] border-dashed border-border-dash-dots flex items-center justify-center text-[17px] leading-none flex-none">
                      +
                    </span>
                    <div>
                      <div className="text-[14.5px] font-semibold">
                        Создать новую пустую марку
                      </div>
                      <div className="text-[12px] text-fg-muted mt-[2px]">
                        Назначения перенесутся на неё
                      </div>
                    </div>
                  </div>
                </>
              )}
            </>
          )}
          {!replacing && (
            <button
              onClick={onClose}
              className="w-full mt-[14px] bg-transparent border border-border-muted text-fg-body rounded-[12px] py-[13px] font-sans text-[14px] font-semibold cursor-pointer"
            >
              Отмена
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── ProcureModal ────────────────────────────────────────────────
interface ProcureModalProps {
  accent: string;
  procEmpty: boolean;
  procDeliveredPct: number;
  procHeadline: string;
  procScopeSumStr: string;
  procBars: Array<{ color: string; width: string }>;
  procStages: Array<{
    label: string;
    sub: string;
    color: string;
    count: number;
    sumStr: string;
    hasItems: boolean;
    noItems: boolean;
    items: SpecItem[];
  }>;
  hasProcReplace: boolean;
  procReplaceCount: number;
  procReplaceSumStr: string;
  stReplace: { count: number; items: SpecItem[] };
  hasProcPick: boolean;
  procPickCount: number;
  procPickSumStr: string;
  onClose: () => void;
  onOpen: (id: string) => void;
  onShowReplace: () => void;
}

export function ProcureModal({
  accent,
  procEmpty,
  procDeliveredPct,
  procHeadline,
  procScopeSumStr,
  procBars,
  procStages,
  hasProcReplace,
  procReplaceCount,
  procReplaceSumStr,
  stReplace,
  hasProcPick,
  procPickCount,
  procPickSumStr,
  onClose,
  onOpen,
  onShowReplace,
}: ProcureModalProps) {
  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-70 overflow-y-auto"
      style={{
        background: "rgba(27,26,23,.5)",
        padding: "clamp(10px,4vh,40px) 14px",
      }}
    >
      <div
        onClick={(e: React.MouseEvent) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        data-modal="procure"
        tabIndex={-1}
        className="max-w-[760px] mx-auto bg-bg rounded-[20px] overflow-hidden outline-none shadow-[0_30px_80px_rgba(27,26,23,.34)]"
      >
        <div className="flex items-center justify-between gap-3 py-[18px] px-6 bg-bg border-b border-[#e2ddd1]">
          <span className="font-mono text-[12px] tracking-[.1em] uppercase text-fg-muted">
            Закупка и поставка
          </span>
          <button
            onClick={onClose}
            type="button"
            aria-label="Закрыть"
            className="bg-none border-none cursor-pointer text-[20px] text-fg leading-none p-1"
          >
            ✕
          </button>
        </div>

        <div className="py-[clamp(20px,4vw,32px)] px-[clamp(20px,4vw,32px)] max-h-[78vh] overflow-y-auto">
          {procEmpty ? (
            <div className="text-center py-12 px-5 text-fg-muted">
              <div className="text-[19px] font-semibold text-fg">
                Закупка ещё не началась
              </div>
              <div className="text-[14px] mt-2 leading-[1.5]">
                Как только позиции получат статус «Согласовано», они появятся
                <br />в воронке закупки и поставки.
              </div>
            </div>
          ) : (
            <>
              {/* Top summary */}
              <div className="flex items-end justify-between gap-[18px] flex-wrap">
                <div>
                  <div className="text-[clamp(24px,4vw,34px)] font-bold tracking-[-.02em] leading-none">
                    {procDeliveredPct}%
                  </div>
                  <div className="text-[14px] text-[#6a665a] mt-[6px]">
                    {procHeadline}
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-mono text-[10px] tracking-[.1em] uppercase text-fg-muted">
                    Сумма в закупке
                  </div>
                  <div className="text-[20px] font-bold tracking-[-.01em] mt-[4px]">
                    {procScopeSumStr} ₽
                  </div>
                </div>
              </div>

              {/* Progress bars */}
              <div className="flex h-[12px] rounded-[7px] overflow-hidden mt-4 bg-[#ece6da]">
                {procBars.map((b, i) => (
                  <div
                    key={i}
                    style={{ width: b.width, background: b.color }}
                  ></div>
                ))}
              </div>

              {/* Stages */}
              {procStages.map((s, i) => (
                <div key={i} className="mt-6">
                  <div className="flex items-center justify-between gap-3 pb-[11px] border-b border-fg">
                    <div className="flex items-center gap-3 min-w-0">
                      <span
                        className="w-3 h-3 rounded-full flex-none"
                        style={{ background: s.color }}
                      ></span>
                      <div className="min-w-0">
                        <div className="text-[15.5px] font-bold tracking-[-.01em]">
                          {s.label}{" "}
                          <span className="font-mono text-[11px] font-medium text-fg-muted">
                            · {s.count}
                          </span>
                        </div>
                        <div className="font-mono text-[10.5px] tracking-[.02em] text-fg-muted mt-[2px]">
                          {s.sub}
                        </div>
                      </div>
                    </div>
                    <span className="font-mono text-[13px] font-semibold whitespace-nowrap">
                      {s.sumStr} ₽
                    </span>
                  </div>
                  {s.hasItems ? (
                    s.items.map((it: SpecItem) => (
                      <div
                        key={it.id}
                        onClick={() => onOpen(it.id)}
                        className="grid grid-cols-[56px_minmax(120px,1.6fr)_116px_116px] gap-3 items-center py-[11px] px-1 border-b border-[#ece6da] cursor-pointer hover:bg-[#faf8f3] transition-colors"
                      >
                        <span className="font-mono text-[12px] font-medium text-[#46423a]">
                          {it.code}
                        </span>
                        <div className="min-w-0">
                          <div className="text-[15px] font-semibold truncate">
                            {it.name || "Марка " + it.code}
                          </div>
                          <div className="font-mono text-[10.5px] text-fg-muted mt-[1px]">
                            {it.brand}
                          </div>
                        </div>
                        <span className="font-mono text-[12.5px] text-right text-[#46423a]">
                          {it.qty} {it.unit} × {fmt(it.price)}
                        </span>
                        <span className="font-sans text-[15px] font-bold text-right">
                          {fmt(it.qty * it.price)} ₽
                        </span>
                      </div>
                    ))
                  ) : (
                    <div className="py-3 px-1 text-[13px] text-[#a8a296]">
                      Нет позиций на этой стадии.
                    </div>
                  )}
                </div>
              ))}

              {/* Replace section */}
              {hasProcReplace && (
                <div className="mt-6 bg-bg-red-light border border-[#ecccc4] rounded-[14px] py-[15px] px-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <span className="w-3 h-3 rounded-full flex-none bg-[#bf5345]"></span>
                      <span className="text-[14.5px] font-bold text-[#a23b2e]">
                        Требуют замены · {procReplaceCount}
                      </span>
                    </div>
                    <span
                      onClick={onShowReplace}
                      className="font-sans text-[13px] font-semibold text-[#a23b2e] cursor-pointer whitespace-nowrap hover:underline"
                    >
                      Открыть в списке →
                    </span>
                  </div>
                  {stReplace.items.map((it: SpecItem) => (
                    <div
                      key={it.id}
                      onClick={() => onOpen(it.id)}
                      className="flex items-center gap-3 pt-2 cursor-pointer"
                    >
                      <span className="font-mono text-[11.5px] font-medium text-[#a23b2e] flex-none">
                        {it.code}
                      </span>
                      <span className="text-[13.5px] font-medium text-[#6b4039] truncate">
                        {it.name || "Марка " + it.code}
                      </span>
                      <span className="ml-auto font-mono text-[11.5px] text-[#9b6f64] whitespace-nowrap">
                        {fmt(it.qty * it.price)} ₽
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* Pick section */}
              {hasProcPick && (
                <div className="mt-[18px] flex items-center justify-between gap-3 bg-[#faf8f3] border border-[#e6e1d5] rounded-[13px] py-[13px] px-4">
                  <div className="flex items-center gap-[10px]">
                    <span className="w-[9px] h-[9px] rounded-full flex-none bg-[#bcb7ab]"></span>
                    <span className="text-[13.5px] text-[#46423a]">
                      Ещё в подборе · {procPickCount}
                    </span>
                  </div>
                  <span className="font-mono text-[12px] text-fg-muted">
                    {procPickSumStr} ₽ · до закупки
                  </span>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── SummaryModal ────────────────────────────────────────────────
interface SummaryModalProps {
  items: SpecItem[];
  onClose: () => void;
  onPrint: () => void;
  onExportCsv: () => void;
}

export function SummaryModal({
  items,
  onClose,
  onPrint,
  onExportCsv,
}: SummaryModalProps) {
  const grandTotal = items.reduce(
    (s: number, it: SpecItem) => s + it.qty * it.price,
    0,
  );
  const grouped = items.reduce((acc: Record<string, SpecItem[]>, it) => {
    (acc[it.type] = acc[it.type] || []).push(it);
    return acc;
  }, {});

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-70 overflow-y-auto"
      style={{
        background: "rgba(27,26,23,.5)",
        padding: "clamp(10px,4vh,40px) 14px",
      }}
    >
      <div
        id="spec-summary"
        onClick={(e: React.MouseEvent) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        data-modal="summary"
        tabIndex={-1}
        className="max-w-[900px] mx-auto bg-white rounded-[18px] overflow-hidden outline-none"
        style={{ boxShadow: "0 30px 80px rgba(27,26,23,.34)" }}
      >
        <div className="sticky top-0 z-2 flex items-center justify-between gap-3 py-4 px-[clamp(18px,4vw,28px)] bg-white border-b border-border-subtle">
          <span className="font-mono text-[12px] tracking-[.1em] uppercase text-fg-muted">
            Сводка спецификации
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={onExportCsv}
              className="flex items-center gap-2 bg-bg-card border border-border-muted text-fg rounded-[11px] py-[11px] px-4 font-sans text-[14px] font-semibold cursor-pointer"
            >
              Excel (CSV)
            </button>
            <button
              onClick={onPrint}
              className="flex items-center gap-2 bg-bg-accent border-none text-bg rounded-[11px] py-[11px] px-4 font-sans text-[14px] font-semibold cursor-pointer"
            >
              Печать / PDF
            </button>
            <button
              onClick={onClose}
              type="button"
              aria-label="Закрыть"
              className="bg-none border-none cursor-pointer text-[20px] text-fg leading-none p-1"
            >
              ✕
            </button>
          </div>
        </div>
        <div className="py-[clamp(24px,5vw,46px)] px-[clamp(24px,5vw,46px)]">
          <div className="flex items-end justify-between gap-5 flex-wrap border-b-2 border-fg pb-5">
            <div>
              <div className="font-mono text-[11px] tracking-[.1em] uppercase text-fg-muted">
                Седьмой тестовый проект
              </div>
              <div className="text-[clamp(28px,5vw,40px)] font-bold tracking-[-.02em] leading-none mt-2">
                Спецификация материалов
              </div>
            </div>
            <div className="text-right font-mono text-[11px] text-fg-muted leading-[1.7]">
              <div>
                Дата ·{" "}
                {new Date().toLocaleDateString("ru-RU", {
                  day: "2-digit",
                  month: "long",
                  year: "numeric",
                })}
              </div>
              <div>Позиций · {items.length}</div>
            </div>
          </div>

          {Object.entries(grouped).map(([type, its]) => {
            const typeSum = its.reduce((s, it) => s + it.qty * it.price, 0);
            return (
              <div key={type} className="mt-6 summary-break">
                <div className="flex items-center justify-between py-3 border-b border-fg">
                  <span className="font-mono text-[12px] tracking-[.12em] uppercase font-semibold">
                    {type}
                  </span>
                  <span className="font-mono text-[12px] text-fg-muted">
                    {its.length} · {fmt(typeSum)} ₽
                  </span>
                </div>
                <div className="w-full">
                  {its
                    .filter((it) => !it.isPlaceholder)
                    .map((it) => (
                      <div
                        key={it.id}
                        className="flex items-start gap-3 py-3 border-b border-border"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="text-[14px] font-semibold">
                            {it.name || "Марка " + it.code}
                          </div>
                          <div className="font-mono text-[10px] text-fg-muted mt-0.5">
                            {it.code} · {it.brand}
                          </div>
                          <div className="text-[12px] text-fg-body mt-1">
                            {it.spec}
                          </div>
                        </div>
                        <div className="text-right flex-none">
                          <div className="font-mono text-[12px] text-fg-muted">
                            {it.qty} {it.unit} × {fmt(it.price)}
                          </div>
                          <div className="font-sans text-[16px] font-bold">
                            {fmt(it.qty * it.price)} ₽
                          </div>
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            );
          })}

          <div className="flex items-baseline justify-between gap-4 mt-6 flex-wrap pt-4 border-t-2 border-fg">
            <span className="font-mono text-[11px] tracking-[.12em] uppercase text-fg-muted">
              Итого по спецификации
            </span>
            <span className="text-[clamp(30px,6vw,44px)] font-bold tracking-[-.02em]">
              {fmt(grandTotal)} ₽
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
