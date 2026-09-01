"use client";

import { Button } from "@/components/ui/button";
import Link from "next/link";
import { Plus, UserPlus } from "lucide-react";
import { useDialogUrl } from "@/hooks/use-dialog-url";

/**
 * Кнопки шапки страницы контактов, открывающие диалоги добавления.
 * Диалоги управляются URL (см. useDialogUrl):
 *   ?dialog=contact&independent=1  — добавить специалиста
 *   ?dialog=company                — добавить компанию
 * Сами диалоги рендерит ContactsList, здесь достаточно сгенерировать ссылки.
 */
export function ContactsHeaderActions() {
  const { hrefFor } = useDialogUrl("dialog");

  return (
    <div className="flex flex-wrap w-full justify-end items-center gap-2">
      <Button
        nativeButton={false}
        render={<Link href={hrefFor("contact", { independent: "1" })} />}
        variant="outline"
        size="lg"
        className="flex-1 whitespace-nowrap bg-bg sm:flex-none"
      >
        <UserPlus className="mr-1 size-4" /> Добавить специалиста
      </Button>
      <Button
        nativeButton={false}
        render={<Link href={hrefFor("company")} />}
        size="lg"
        className="flex-1 bg-fg whitespace-nowrap sm:flex-none"
      >
        <Plus className="mr-1 size-4" /> Добавить компанию
      </Button>
    </div>
  );
}
