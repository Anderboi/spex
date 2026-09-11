"use client";

import { Button } from "@/components/ui/button";
import Link from "next/link";
import { ChevronDown, Plus, UserPlus } from "lucide-react";
import { useDialogUrl } from "@/hooks/use-dialog-url";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * Кнопка шапки страницы контактов, открывающая диалоги добавления.
 * Диалоги управляются URL (см. useDialogUrl):
 *   ?dialog=contact&independent=1  — добавить специалиста
 *   ?dialog=company                — добавить компанию
 * Сами диалоги рендерит ContactsList, здесь достаточно сгенерировать ссылки.
 */
export function ContactsHeaderActions() {
  const { hrefFor } = useDialogUrl("dialog");

  return (
    <div className="flex flex-wrap w-full justify-end items-center gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              size="lg"
              className="flex-1 h-10 bg-fg whitespace-nowrap sm:flex-none"
            />
          }
        >
          <Plus className="mr-1 size-4" /> Добавить
          <ChevronDown className="ml-1 size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-56 bg-bg-card">
          <DropdownMenuItem
            render={<Link href={hrefFor("company")} />}
            className="gap-2 h-10 whitespace-nowrap"
          >
            <Plus className="size-4" /> Добавить компанию
          </DropdownMenuItem>
          <DropdownMenuItem
            render={<Link href={hrefFor("contact", { independent: "1" })} />}
            className="gap-2 h-10 whitespace-nowrap"
          >
            <UserPlus className="size-4" /> Добавить специалиста
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

