"use client";

/**
 * Кнопка «Импорт по ссылке» в шапке библиотеки материалов.
 *
 * Как и `MaterialsCreateButton`, открывает диалог через URL (`?action=import`)
 * «shallow»-переходом: состояние берётся из search params, а сам переход не
 * ждёт серверного рендера страницы. `href` сохраняем, поэтому средний клик и
 * работа без JavaScript ведут на тот же адрес.
 */

import { Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDialogUrl } from "@/hooks/use-dialog-url";

export function MaterialsImportButton() {
  const { linkProps } = useDialogUrl("action", [], { shallow: true });

  return (
    <Button
      nativeButton={false}
      variant="outline"
      render={
        <a
          className="flex flex-row items-center gap-2 h-10 border border-border-muted bg-bg-card rounded-lg px-5 text-[15px] font-semibold cursor-pointer"
          {...linkProps("import")}
        />
      }
    >
      <Link2 className="size-4" /> Импорт по ссылке
    </Button>
  );
}
