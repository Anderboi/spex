"use client";

import { Wrench, Truck, AlertTriangle } from "lucide-react";
import { SERVICE_OPERATION_CONFIG } from "@/lib/constants";
import { fmt, fmtCompact, cn } from "@/lib/utils";
import type { ServiceOperation } from "@/actions/service-operations";

const OP_ICON = { installation: Wrench, delivery: Truck } as const;

const MAX_VISIBLE = 2;

function dateLabel(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("ru-RU");
}

function isOverdue(op: ServiceOperation): boolean {
  if (op.type !== "delivery" || op.completed || !op.deadline) return false;
  return new Date(`${op.deadline}T00:00:00`) < new Date();
}

function opTitle(op: ServiceOperation): string {
  const parts = [
    `${SERVICE_OPERATION_CONFIG[op.type].label} · ${fmt(op.amount)} ₽`,
  ];
  if (op.type === "delivery")
    parts.push(op.completed ? "исполнено" : "не исполнено");
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
        const Icon = OP_ICON[op.type];
        const overdue = isOverdue(op);
        const content = (
          <>
            <Icon
              className={cn(
                "size-3 flex-none shrink-0",
                overdue ? "text-fg-red" : "text-fg-dim",
              )}
            />
            <span
              className={cn(
                "font-mono text-[11px] leading-none tabular-nums",
                overdue ? "text-fg-red" : "text-fg-muted",
              )}
            >
              {fmtCompact(op.amount)} ₽
            </span>
            {overdue && <AlertTriangle className="size-3 flex-none shrink-0 text-fg-red" />}
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
      {hidden > 0 && <span className="pl-4 text-[11px] leading-none text-fg-dim">+{hidden}</span>}
    </div>
  );
}
