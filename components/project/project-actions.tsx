"use client";

import Link from "next/link";
import { FileText, MoreHorizontal, Plus, ShoppingCart } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * Действия в шапке проекта.
 *
 * ≥ 640px — три отдельные кнопки, как раньше.
 * < 640px — основная кнопка «Добавить» во всю ширину и меню «…» с остальными
 * действиями: три подписи в строку не помещаются на телефоне и раньше
 * обрезались контейнером.
 */
export function ProjectActions({
  addHref,
  procureHref,
  summaryHref,
}: {
  addHref: string;
  procureHref: string;
  summaryHref: string;
}) {
  return (
    <div className="flex w-full items-center gap-2 sm:w-auto">
      <Button
        nativeButton={false}
        render={<Link href={addHref} />}
        className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-lg bg-bg-accent px-4 text-[13.5px] font-semibold text-bg sm:flex-none"
      >
        <Plus className="size-4" /> Добавить
      </Button>

      {/* ── ≥ 640px: отдельные кнопки ───────────────────────────── */}
      <div className="hidden items-center gap-2 sm:flex">
        <Button
          nativeButton={false}
          variant="outline"
          render={<Link href={procureHref} />}
          className="flex h-10 items-center gap-1.5 rounded-lg border border-border-muted bg-bg-card px-3 text-[13.5px] font-semibold text-fg hover:border-fg"
        >
          Закупка
        </Button>
        <Button
          nativeButton={false}
          variant="outline"
          render={<Link href={summaryHref} />}
          className="flex h-10 items-center gap-1.5 rounded-lg border border-border-muted bg-bg-card px-3 text-[13.5px] font-semibold text-fg hover:border-fg"
        >
          Сводка
        </Button>
      </div>

      {/* ── < 640px: меню «…» ───────────────────────────────────── */}
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label="Другие действия проекта"
          title="Другие действия"
          className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border-muted bg-bg-card text-fg sm:hidden"
        >
          <MoreHorizontal className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48 bg-bg-card">
          <DropdownMenuItem
            className="gap-2 text-[13px]"
            render={<Link href={procureHref} />}
          >
            <ShoppingCart className="size-3.5" /> Закупка
          </DropdownMenuItem>
          <DropdownMenuItem
            className="gap-2 text-[13px]"
            render={<Link href={summaryHref} />}
          >
            <FileText className="size-3.5" /> Сводка
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
