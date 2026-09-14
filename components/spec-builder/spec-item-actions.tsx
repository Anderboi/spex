"use client";

import {
  Copy,
  Eraser,
  MoreHorizontal,
  Plus,
  Share2,
  Trash2,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { SpecItem } from "@/lib/types";
import { ParentSubMenu } from "./parent-submenu";
import type { SpecRowHandlers } from "./spec-row";

/** Меню действий позиции. Общее для всех плотностей списка (строка,
 *  компактная карточка, карточка), чтобы состав действий не расходился. */
export function SpecItemActions({
  item,
  allItems,
  h,
  className,
  deleteLabel = "Удалить",
}: {
  item: SpecItem;
  allItems: SpecItem[];
  h: SpecRowHandlers;
  className?: string;
  deleteLabel?: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Действия для ${item.code}`}
        className={cn(
          "flex shrink-0 items-center justify-center rounded-lg text-fg-muted hover:bg-bg-select",
          className ?? "size-8",
        )}
      >
        <MoreHorizontal className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52 bg-bg-card">
        <DropdownMenuItem
          onClick={() => h.onOpen(item.id)}
          className="text-[13px]"
        >
          Открыть карточку
        </DropdownMenuItem>
        <ParentSubMenu
          item={item}
          allItems={allItems}
          onSetParent={(parentId) => h.onSetParent(item.id, parentId)}
        />
        <DropdownMenuItem
          onClick={() => h.onAddChild(item.id)}
          className="gap-2 text-[13px]"
        >
          <Plus className="size-3.5" /> Добавить субэлемент
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => h.onDuplicate(item.id)}
          className="gap-2 text-[13px]"
        >
          <Copy className="size-3.5" /> Дублировать
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => h.onShare(item)}
          className="gap-2 text-[13px]"
        >
          <Share2 className="size-3.5" /> Поделиться
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => h.onClear(item.id)}
          className="gap-2 text-[13px]"
        >
          <Eraser className="size-3.5" /> Очистить, оставив марку
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => h.onDelete(item.id)}
          className="gap-2 text-[13px] text-fg-red"
        >
          <Trash2 className="size-3.5" /> {deleteLabel}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
