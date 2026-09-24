"use client";

import { ChevronDown } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

/**
 * Универсальная строка-аккордеон вкладки «Обзор»: заголовок с иконкой и
 * сводкой, справа — действие и шеврон. Всё, что сложнее и опаснее сводки,
 * живёт внутри панели, чтобы «Обзор» оставался коротким списком состояния
 * позиции, а не вторым редактором.
 */
export function OverviewSection({
  icon: Icon,
  title,
  summary,
  action,
  defaultOpen = false,
  children,
}: {
  icon: LucideIcon;
  /** Постоянная подпись блока: «Поставка», «Помещения»… */
  title: string;
  /** Сводка в закрытом состоянии: поставщик, срок, количество и т.п. */
  summary: React.ReactNode;
  /**
   * Управляющее действие блока (например, «Открыть» на вкладку). Клики по
   * нему не должны разворачивать панель, поэтому оно вынесено из триггера.
   */
  action?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Collapsible
      defaultOpen={defaultOpen}
      // Открытое состояние помечает триггер (`data-panel-open`), панель —
      // только `data-open`, поэтому фон карточки вешаем на корень по
      // атрибуту триггера: у панели в закрытом состоянии атрибута нет вовсе.
      className="overflow-hidden rounded-xl border border-border-muted bg-bg-card transition-colors //has-data-panel-open:bg-bg-card2"
    >
      <div className="flex items-center gap-2 py-1 pr-2 pl-3">
        <CollapsibleTrigger
          className={cn(
            "group/ov flex min-w-0 flex-1 items-center gap-2.5 rounded-lg py-2 text-left outline-none",
            "focus-visible:ring-3 focus-visible:ring-ring/50",
          )}
        >
          <span className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-border-muted bg-bg-card2 text-fg-secondary">
            <Icon className="size-3.5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[13.5px] font-semibold text-fg">
              {title}
            </span>
            <span className="mt-0.5 block truncate text-[12px] text-fg-muted">
              {summary}
            </span>
          </span>
          <ChevronDown
            aria-hidden
            className="size-4 shrink-0 text-fg-dim transition-transform duration-200 group-aria-expanded/ov:rotate-180 motion-reduce:transition-none"
          />
        </CollapsibleTrigger>

        {action}
      </div>

      <CollapsibleContent className="border-t border-border-muted px-3 py-3">
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}

export default OverviewSection;
