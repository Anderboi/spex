"use client";

import { AlertTriangle } from "lucide-react";
import { operationLabel } from "@/lib/constants";
import { fmt, cn } from "@/lib/utils";
import { serviceOperationDeadline } from "@/lib/spec/service-operation-deadline";
import type { ServiceOperation } from "@/actions/service-operations";
import { SERVICE_OPERATION_ICON } from "./service-operation-icons";

const MAX_VISIBLE = 2;

function dateLabel(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("ru-RU");
}

function opTitle(op: ServiceOperation): string {
  const parts = [`${operationLabel(op)} · ${fmt(op.amount)} ₽`];
  parts.push(op.completed ? "исполнено" : "не исполнено");
  // Сумма операции общая на все её позиции: в подсказке видно, сколько их.
  if (op.spec_item_ids.length > 1) {
    parts.push(`позиций в операции: ${op.spec_item_ids.length}`);
  }
  if (op.deadline) parts.push(`срок: ${dateLabel(op.deadline)}`);
  if (op.contractor_name) parts.push(`подрядчик: ${op.contractor_name}`);
  if (op.notes) parts.push(op.notes);
  return parts.join("\n");
}

/**
 * Тихая строка метаданных для операций доп. расходов (монтаж, доставка),
 * привязанных к позиции. Намеренно НЕ оформлена как pill/чип — это
 * информационная аннотация, а не элемент управления, и не должна визуально
 * спорить со статусом позиции или со свитчером вариантов.
 *
 * Суммы операции здесь нет: она одна на все позиции операции, и в строке одной
 * позиции читалась бы как её расход. Видны тип, признак просрочки и счётчик
 * скрытых операций; сумма, срок и подрядчик — в подсказке и в модалке.
 *
 * Показываются в строке таблицы и в карточке на мобильном. Когда передан
 * onOpen — строка кликабельна и открывает операцию в модалке редактирования.
 */
export function ServiceOperationBadges({
  ops,
  onOpen,
}: {
  ops?: ServiceOperation[];
  /** Открыть операцию в модалке редактирования. */
  onOpen?: (operationId: string) => void;
}) {
  if (!ops || ops.length === 0) return null;

  const visible = ops.slice(0, MAX_VISIBLE);
  const hidden = ops.length - visible.length;

  return (
    <div className="flex flex-col items-start gap-1">
      {visible.map((op) => {
        const Icon = SERVICE_OPERATION_ICON[op.type];
        // Просрочка считается тем же правилом, что и срок в строке услуги:
        // исполненная операция активного дедлайна не имеет.
        const overdue = serviceOperationDeadline(op)?.overdue ?? false;
        const content = (
          <>
            <Icon
              className={cn(
                "size-3 flex-none shrink-0",
                overdue ? "text-fg-red" : "text-fg-dim",
              )}
            />
            {overdue && (
              <AlertTriangle className="size-3 flex-none shrink-0 text-fg-red" />
            )}
          </>
        );
        return onOpen ? (
          <button
            key={op.id}
            type="button"
            title={opTitle(op)}
            aria-label={`Редактировать: ${opTitle(op)}`}
            onClick={() => onOpen(op.id)}
            className={cn(
              "flex cursor-pointer items-center gap-1 rounded transition-colors",
              overdue
                ? "hover:text-fg-red/80"
                : "hover:text-fg [&>svg]:hover:text-fg-secondary",
            )}
          >
            {content}
          </button>
        ) : (
          <span
            key={op.id}
            title={opTitle(op)}
            className="flex items-center gap-1"
          >
            {content}
          </span>
        );
      })}
      {hidden > 0 && (
        <span className="pl-4 text-[11px] leading-none text-fg-dim">
          +{hidden}
        </span>
      )}
    </div>
  );
}
