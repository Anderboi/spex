"use client";

import { useState } from "react";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { typePresetsFor } from "@/lib/constants";
import { cn } from "@/lib/utils";

/**
 * Выбор ТИПА материала внутри категории (керамогранит, ламинат, обои…).
 *
 * Справочник рекомендательный: показываем пресеты категории, но если нужного
 * типа в списке нет — его можно ввести строкой. Иначе неполный справочник
 * блокировал бы работу, а свободный текст без подсказок плодил бы дубли
 * («Керамогранит» / «керамогранит»).
 *
 * Компонент управляемый: `value` — строка или null, `onChange` получает
 * нормализованное значение (пустая строка → null).
 */
export function MaterialTypePicker({
  value,
  onChange,
  category,
  placeholder = "Выберите или введите тип",
  disabled = false,
  className,
  triggerClassName,
  id,
  ariaLabel = "Тип материала",
}: {
  value: string | null | undefined;
  onChange: (value: string | null) => void;
  /** Категория, по которой берутся пресеты типов. */
  category: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  triggerClassName?: string;
  id?: string;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const presets = typePresetsFor(category);
  const current = (value ?? "").trim();

  // «Добавить своё» показываем только когда запрос не совпал ни с одним
  // пресетом и не равен уже выбранному значению.
  const typed = query.trim();
  const canCreate =
    typed.length > 0 &&
    typed !== current &&
    !presets.some((p) => p.toLowerCase() === typed.toLowerCase());

  const commit = (next: string | null) => {
    const clean = (next ?? "").trim();
    onChange(clean.length > 0 ? clean : null);
    setOpen(false);
    setQuery("");
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        // Закрытие без выбора не должно оставлять прошлый запрос: иначе при
        // следующем открытии список окажется отфильтрованным «навсегда».
        if (!next) setQuery("");
      }}
    >
      <PopoverTrigger
        render={
          <Button
            id={id}
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-label={ariaLabel}
            disabled={disabled}
            className={cn(
              "h-10 w-full justify-between bg-bg-card font-normal",
              !current && "text-fg-muted",
              triggerClassName,
            )}
          >
            <span className="truncate">{current || placeholder}</span>
            <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
          </Button>
        }
      />
      <PopoverContent
        className={cn("w-(--anchor-width) min-w-60 p-0", className)}
        align="start"
      >
        <Command>
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder="Найти или ввести тип…"
          />
          <CommandList>
            <CommandEmpty>Тип не найден — введите свой.</CommandEmpty>
            <CommandGroup>
              <CommandItem value="__none" onSelect={() => commit(null)}>
                <Check
                  className={cn(
                    "mr-2 size-4",
                    current ? "opacity-0" : "opacity-100",
                  )}
                />
                <span className="text-fg-muted">Не указан</span>
              </CommandItem>
            </CommandGroup>

            {presets.length > 0 && (
              <CommandGroup heading={`Типы · ${category}`}>
                {presets.map((preset) => (
                  <CommandItem
                    key={preset}
                    value={preset}
                    onSelect={() => commit(preset)}
                  >
                    <Check
                      className={cn(
                        "mr-2 size-4",
                        current === preset ? "opacity-100" : "opacity-0",
                      )}
                    />
                    {preset}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {canCreate && (
              <CommandGroup heading="Своё значение">
                <CommandItem value={typed} onSelect={() => commit(typed)}>
                  <Plus className="mr-2 size-4" />
                  Добавить «{typed}»
                </CommandItem>
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
