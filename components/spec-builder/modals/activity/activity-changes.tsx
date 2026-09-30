"use client";

import { useState } from "react";
import { ArrowRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { ActivityChange } from "@/lib/spec/activity-format";

/**
 * Компактная таблица изменений для `details_changed` и `variant_updated`.
 *
 * Показываются первые `VISIBLE_CHANGES` строк: событие с десятком изменений не
 * должно занимать всю ленту. Раскрытие — локальное состояние ЭТОЙ записи
 * (компонент смонтирован на одну запись), поэтому соседние записи не
 * разворачиваются вместе с ней и payload не меняется.
 *
 * Разметка собрана из `div`-ов, а не из `<table>`: событие живёт внутри
 * `MarkerContent` (это `span`), и настоящая таблица внутри абзаца/строки —
 * невалидный HTML. Ограничение то же, что и у `Message` в этом проекте: там
 * `MessageHeader` — тоже `div`.
 */
const VISIBLE_CHANGES = 4;

export default function ActivityChanges({
  changes,
}: {
  changes: readonly ActivityChange[];
}) {
  const [expanded, setExpanded] = useState(false);

  if (changes.length === 0) return null;

  const hidden = changes.length - VISIBLE_CHANGES;
  const visible = expanded ? changes : changes.slice(0, VISIBLE_CHANGES);

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-col divide-y divide-border-muted overflow-hidden rounded-lg border border-border-muted bg-bg-card2">
        {visible.map((change) => (
          <div
            key={change.field}
            /*
              «поле · было · стало»: подпись фиксированной ширины, значение во
              всю оставшуюся ширину, чтобы длинный список не распирал ленту.
            */
            className="flex min-w-0 flex-col gap-0.5 px-2.5 py-1.5 sm:flex-row sm:items-baseline sm:gap-x-3"
          >
            <span className="min-w-0 shrink-0 text-[11.5px] text-fg-muted sm:w-36 sm:truncate">
              {change.label}
            </span>

            <span className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
              <span className="min-w-0 wrap-break-word text-[12px] text-fg-muted line-through decoration-border">
                {change.from}
              </span>
              <ArrowRight
                aria-hidden="true"
                className="size-3 shrink-0 text-fg-muted"
              />
              <span className="min-w-0 wrap-break-word text-[12px] text-fg">
                {change.to}
              </span>
            </span>
          </div>
        ))}
      </div>

      {hidden > 0 && (
        <Button
          type="button"
          variant="ghost"
          size="xs"
          className="self-start text-fg-muted"
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded ? "Свернуть" : `Показать все (${changes.length})`}
        </Button>
      )}
    </div>
  );
}
