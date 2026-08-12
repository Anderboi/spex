"use client";

import React, { useState } from "react";
import { Check, ChevronsUpDown, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface CategoryMultiSelectProps {
  options: readonly string[];
  selected: string[];
  onChange: (selected: string[]) => void;
}

export function CategoryMultiSelect({
  options,
  selected = [],
  onChange,
}: CategoryMultiSelectProps) {
  const [open, setOpen] = useState(false);

  const toggleCategory = (type: string) => {
    if (selected.includes(type)) {
      onChange(selected.filter((item) => item !== type));
    } else {
      onChange([...selected, type]);
    }
  };

  const removeItem = (type: string, e: React.MouseEvent) => {
    e.stopPropagation();
    onChange(selected.filter((item) => item !== type));
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger>
        <span
          role="combobox"
          aria-expanded={open}
          className="w-full min-h-8 h-auto border flex rounded-lg items-center justify-between px-3 py-1.5 font-normal //bg-bg //hover:bg-bg border-border"
        >
          <div className="flex flex-wrap gap-1 items-center max-w-[calc(100%-20px)]">
            {selected.length === 0 ? (
              <span className="text-fg-muted text-sm">
                Выберите категории...
              </span>
            ) : (
              selected.map((item) => (
                <Badge
                  key={item}
                  variant="secondary"
                  className="text-xs px-2 py-0.5 rounded-md gap-1 bg-bg-brand text-fg-secondary"
                >
                  {item}
                  <X
                    className="size-3 cursor-pointer hover:text-destructive"
                    onClick={(e) => removeItem(item, e)}
                  />
                </Badge>
              ))
            )}
          </div>
          <ChevronsUpDown className="size-4 shrink-0 opacity-50 ml-1" />
        </span>
      </PopoverTrigger>

      <PopoverContent className="w-[--radix-popover-trigger-width] p-1 max-h-56 overflow-y-auto">
        <div className="flex flex-col gap-0.5">
          {options.map((option) => {
            const isSelected = selected.includes(option);
            return (
              <button
                key={option}
                type="button"
                onClick={() => toggleCategory(option)}
                className={cn(
                  "flex items-center justify-between w-full px-2.5 py-1.5 text-xs rounded-md transition-colors text-left",
                  isSelected
                    ? "bg-bg-brand text-fg-secondary font-medium"
                    : "hover:bg-muted/60 text-fg",
                )}
              >
                <span>{option}</span>
                {isSelected && <Check className="size-3.5 text-primary" />}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
