"use client";

import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDialogUrl } from "@/hooks/use-dialog-url";

/**
 * Кнопка «Добавить» в шапке библиотеки материалов.
 *
 * Клиентский компонент, потому что открытие диалога — это переход по URL
 * (`?action=create`), а `<Link>` такой переход делает через сервер: пока не
 * приедет новый RSC-пейлоад со всей страницей, диалог не появится. Здесь
 * переход делается «shallow» (History API, см. `useDialogUrl`), поэтому окно
 * открывается сразу.
 *
 * `href` сохраняем: средний клик, «открыть в новой вкладке» и работа без
 * JavaScript по-прежнему ведут на тот же URL, а сервер отрисует диалог открытым
 * (состояние «открыт» выводится из search params, см. `MaterialsClient`).
 */
export function MaterialsCreateButton() {
  const { linkProps } = useDialogUrl("action", [], { shallow: true });

  return (
    <Button
      nativeButton={false}
      render={
        <a
          className="flex flex-row items-center gap-2 h-10 bg-bg-accent border-none rounded-lg px-6 text-[15px] font-semibold cursor-pointer"
          {...linkProps("create")}
        />
      }
    >
      <Plus className="size-4" /> Добавить
    </Button>
  );
}
