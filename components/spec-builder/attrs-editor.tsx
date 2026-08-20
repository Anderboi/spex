"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import { ATTR_PRESETS } from "@/lib/constants";

export function AttrsEditor({
  type,
  attrs,
  onChange,
}: {
  type: string;
  attrs: Record<string, string>;
  onChange: (attrs: Record<string, string>) => void;
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

  const presets = ATTR_PRESETS[type] ?? ATTR_PRESETS["Прочее"];
  const rows = [...new Set([...Object.keys(attrs), ...presets])];

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-2">
        {rows.map((key) => {
          const isPreset = presets.includes(key);
          return (
            <li key={key} className="flex items-center gap-2">
              <span
                className="w-44 shrink-0 truncate text-[12.5px] text-fg-secondary"
                title={key}
              >
                {key}
              </span>
              <input
                defaultValue={attrs[key] ?? ""}
                onBlur={(e) => setValue(key, e.target.value)}
                placeholder="—"
                aria-label={key}
                className="h-9 min-w-0 flex-1 rounded-md border border-border-muted bg-bg px-3 text-sm outline-none focus:border-fg-brand"
              />
              {!isPreset && (
                <button
                  type="button"
                  onClick={() => removeKey(key)}
                  aria-label={`Удалить «${key}»`}
                  className="flex size-8 shrink-0 items-center justify-center rounded-md text-fg-muted hover:bg-bg-select"
                >
                  <X className="size-3.5" />
                </button>
              )}
            </li>
          );
        })}
      </ul>

      <div className="flex gap-2 border-t border-border-muted pt-3">
        <input
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
          className="h-9 flex-1 rounded-md border border-border-muted bg-bg px-3 text-sm outline-none focus:border-fg-brand"
        />
        <button
          type="button"
          onClick={addKey}
          disabled={!newKey.trim()}
          className="flex h-9 items-center gap-1.5 rounded-md border border-border-muted px-3 text-[13px] disabled:opacity-40"
        >
          <Plus className="size-3.5" /> Добавить
        </button>
      </div>
    </div>
  );
}
