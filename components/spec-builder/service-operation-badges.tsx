"use client";

import { SERVICE_OPERATION_CONFIG } from "@/lib/constants";
import { fmt } from "@/lib/utils";
import type { ServiceOperation } from "@/actions/service-operations";

function dateLabel(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("ru-RU");
}

function opTitle(op: ServiceOperation): string {
  const parts = [
    `${SERVICE_OPERATION_CONFIG[op.type].label} · ${fmt(op.amount)} ₽`,
  ];
  if (op.deadline) parts.push(`срок: ${dateLabel(op.deadline)}`);
  if (op.contractor_name) parts.push(`подрядчик: ${op.contractor_name}`);
  if (op.notes) parts.push(op.notes);
  return parts.join("\n");
}

/**
 * Компактные бейджи операций дополнительных расходов, привязанных к позиции.
 * Показываются в строке таблицы и в карточке на мобильном.
 */
export function ServiceOperationBadges({
  ops,
}: {
  ops?: ServiceOperation[];
}) {
  if (!ops || ops.length === 0) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {ops.map((op) => (
        <span
          key={op.id}
          title={opTitle(op)}
          className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-border-muted bg-bg-card2 px-1.5 py-0.5 font-mono text-[10.5px] leading-none text-fg-secondary tabular-nums"
        >
          {SERVICE_OPERATION_CONFIG[op.type].label} · {fmt(op.amount)} ₽
        </span>
      ))}
    </div>
  );
}
