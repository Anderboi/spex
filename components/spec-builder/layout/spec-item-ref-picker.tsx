"use client";

import { useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";

/** Вариант выбора для ссылки на существующий SpecItem проекта. */
export type SpecItemRefOption = {
  id: string;
  code: string;
  name: string;
  type: string;
};

/**
 * Поиск/выбор позиции спецификации проекта для строки состава kind = 'spec_ref'.
 * После выбора показывает код и название выбранной позиции.
 */
export function SpecItemRefPicker({
  options,
  value,
  onChange,
  disabled = false,
}: {
  options: SpecItemRefOption[];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const selected = options.find((o) => o.id === value) ?? null;

  const q = query.trim().toLowerCase();
  const filtered = q
    ? options.filter(
        (o) =>
          o.code.toLowerCase().includes(q) ||
          o.name.toLowerCase().includes(q) ||
          o.type.toLowerCase().includes(q),
      )
    : options;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            disabled={disabled}
            className={cn(
              "h-10 w-full justify-between bg-bg-card font-normal",
              !selected && "text-fg-muted",
            )}
          >
            {selected ? (
              <span className="flex min-w-0 items-baseline gap-2">
                {selected.code && (
                  <span className="shrink-0 font-mono text-[12px] font-medium text-fg-secondary">
                    {selected.code}
                  </span>
                )}
                <span className="truncate">{selected.name}</span>
              </span>
            ) : (
              <span>Выберите позицию спецификации…</span>
            )}
            <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
          </Button>
        }
      />
      <PopoverContent className="w-full bg-bg-card p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder="Поиск по коду, названию или типу…"
          />
          <CommandList>
            <CommandEmpty>
              {options.length === 0
                ? "Все доступные позиции уже добавлены в эту группу"
                : "Позиции не найдены"}
            </CommandEmpty>
            {filtered.map((o) => {
              const isSelected = o.id === value;
              return (
                <CommandItem
                  key={o.id}
                  value={o.id}
                  onSelect={() => {
                    onChange(o.id);
                    setOpen(false);
                    setQuery("");
                  }}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4 shrink-0",
                      isSelected ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <span className="w-14 shrink-0 truncate font-mono text-[11.5px] text-fg-secondary">
                    {o.code || "—"}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{o.name}</span>
                  <span className="ml-2 shrink-0 text-[11px] text-fg-muted">
                    {o.type}
                  </span>
                </CommandItem>
              );
            })}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
