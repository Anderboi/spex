"use client";

import { useState } from "react";
import { X, Plus } from "lucide-react";

/** Типовые помещения — чтобы не печатать «Санузел» в сотый раз. */
const PRESETS = [
  "Прихожая",
  "Гостиная",
  "Кухня",
  "Спальня",
  "Детская",
  "Кабинет",
  "Санузел",
  "Ванная",
  "Гардеробная",
  "Балкон",
  "Коридор",
];

export function RoomsEditor({
  rooms,
  onChange,
}: {
  rooms: string[];
  onChange: (rooms: string[]) => void;
}) {
  const [draft, setDraft] = useState("");

  const add = (name: string) => {
    const r = name.trim();
    if (!r || rooms.includes(r)) return;
    onChange([...rooms, r]);
    setDraft("");
  };

  const remove = (name: string) => onChange(rooms.filter((x) => x !== name));
  const unused = PRESETS.filter((p) => !rooms.includes(p));

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
          Назначено {rooms.length > 0 && `· ${rooms.length}`}
        </p>

        {rooms.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border-muted p-3 text-[13px] text-fg-muted">
            Помещения не указаны. Назначения нужны, чтобы посчитать материал по
            комнатам и собрать заказ по объекту.
          </p>
        ) : (
          <ul className="flex flex-wrap gap-1.5">
            {rooms.map((r) => (
              <li key={r}>
                <span className="flex h-7 items-center gap-1 rounded-full bg-bg-brand pl-3 pr-1 text-[12.5px] font-medium">
                  {r}
                  <button
                    type="button"
                    onClick={() => remove(r)}
                    aria-label={`Убрать ${r}`}
                    className="flex size-5 items-center justify-center rounded-full text-fg-secondary hover:bg-bg-select"
                  >
                    <X className="size-3" />
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add(draft);
            }
          }}
          placeholder="Спальня 2, Санузел гостевой…"
          aria-label="Новое помещение"
          className="h-9 flex-1 rounded-md border border-border-muted bg-bg px-3 text-sm outline-none focus:border-fg-brand"
        />
        <button
          type="button"
          onClick={() => add(draft)}
          disabled={!draft.trim()}
          className="flex h-9 items-center gap-1.5 rounded-md border border-border-muted px-3 text-[13px] disabled:opacity-40"
        >
          <Plus className="size-3.5" /> Добавить
        </button>
      </div>

      {unused.length > 0 && (
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
            Быстрый выбор
          </p>
          <ul className="flex flex-wrap gap-1.5">
            {unused.map((p) => (
              <li key={p}>
                <button
                  type="button"
                  onClick={() => add(p)}
                  className="h-7 rounded-full border border-border-muted px-3 text-[12.5px] text-fg-secondary hover:border-fg-brand hover:text-fg"
                >
                  {p}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
