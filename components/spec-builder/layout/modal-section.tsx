"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import ModalBlockLabel from "@/components/layout/modal-block-label";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

/**
 * Сворачиваемый блок модалки: подпись-кнопка со шевроном и содержимое под
 * разделителем.
 *
 * Вкладка «Параметры» длинная, поэтому её блоки («Описание продукта»,
 * «Характеристики», «Заметки») сворачиваются независимо: значение по
 * умолчанию задаёт вызывающий (`defaultOpen`) — основной блок открыт, редкие
 * свёрнуты.
 *
 * Состояние блока-аккордеона не сбрасывается при переключении варианта
 * позиции: сам компонент ввода перемонтируется по `key` в родителе, а этот
 * блок остаётся.
 */
export function ModalSection({
  title,
  defaultOpen = false,
  className,
  children,
}: {
  /** Подпись блока: «Описание продукта», «Характеристики». */
  title: string;
  defaultOpen?: boolean;
  /** Свои классы панели (например, `gap-2` для нескольких полей). */
  className?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="flex flex-col">
      <CollapsibleTrigger
        className={cn(
          "group/section flex min-h-8 items-center justify-between gap-3 rounded-md text-left outline-none transition-colors",
          "hover:text-fg focus-visible:ring-3 focus-visible:ring-ring/50",
        )}
      >
        <ModalBlockLabel>{title}</ModalBlockLabel>
        <ChevronDown
          aria-hidden
          className="size-4 shrink-0 text-fg-dim transition-transform duration-200 group-aria-expanded/section:rotate-180 motion-reduce:transition-none"
        />
      </CollapsibleTrigger>
      {/* Панель не оставляет места в закрытом состоянии: содержимое
          размонтировано, `overflow-hidden` страхует внешние отступы детей. */}
      <CollapsibleContent className="flex flex-col overflow-hidden">
        <Separator className="my-2" />
        <div className={cn("flex flex-col", className)}>{children}</div>
      </CollapsibleContent>
    </Collapsible>
  );
}

export default ModalSection;
