"use client";

import { useMemo } from "react";
import { Check } from "lucide-react";
import {
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import { TYPE_ORDER } from "@/lib/constants";
import { collectForbiddenParentIds } from "@/lib/spec/tree";
import { cn } from "@/lib/utils";
import type { SpecItem } from "@/lib/types";

/**
 * Пункт «В состав…» для меню действий строки: выбор/снятие родителя.
 * Кандидаты — все позиции проекта (кроме плейсхолдеров и запрещённых:
 * сама строка и её потомки), сгруппированные по type.
 */
export function ParentSubMenu({
  item,
  allItems,
  onSetParent,
}: {
  item: SpecItem;
  allItems: SpecItem[];
  onSetParent: (parentId: string | null) => void;
}) {
  const groups = useMemo(() => {
    const forbidden = collectForbiddenParentIds(allItems, item.id);
    const candidates = allItems.filter(
      (it) =>
        !forbidden.has(it.id) &&
        !it.isPlaceholder &&
        it.code.trim().length > 0 &&
        it.name.trim().length > 0,
    );
    return TYPE_ORDER.map((type) => ({
      type,
      items: candidates.filter((it) => it.type === type),
    })).filter((g) => g.items.length > 0);
  }, [allItems, item.id]);

  const mark = (active: boolean) => (
    <span
      className={cn(
        "flex size-3.5 flex-none items-center justify-center",
        active ? "text-fg" : "text-transparent",
      )}
    >
      <Check className="size-3.5" />
    </span>
  );

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger className="gap-2 text-[13px]">
        В состав…
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="max-h-80 w-80 bg-bg-card">
        <DropdownMenuItem
          onClick={() => onSetParent(null)}
          className="gap-2 text-[13px]"
        >
          {mark(item.parentId === null)}
          <span className="min-w-0 flex-1 truncate">Без родителя</span>
        </DropdownMenuItem>

        {groups.length > 0 && (
          <>
            <DropdownMenuSeparator />
            {groups.map((g) => (
              <DropdownMenuGroup key={g.type}>
                <DropdownMenuLabel className="px-1.5 py-1 font-mono text-[10.5px] uppercase tracking-[.08em] text-fg-dim">
                  {g.type}
                </DropdownMenuLabel>
                {g.items.map((c) => (
                  <DropdownMenuItem
                    key={c.id}
                    onClick={() => onSetParent(c.id)}
                    className="gap-2 text-[13px]"
                  >
                    {mark(c.id === item.parentId)}
                    <span className="flex-none font-mono text-[12px] text-fg-secondary">
                      {c.code}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{c.name}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
            ))}
          </>
        )}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
