"use client";

import { memo } from "react";
import { ChevronRight, Truck, Wrench } from "lucide-react";
import { SERVICE_OPERATION_CONFIG, type ServiceOperationType } from "@/lib/constants";
import { fmt, plural } from "@/lib/utils";
import type { ServiceOperation } from "@/actions/service-operations";

function dateLabel(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("ru-RU");
}

const OP_ICON: Record<ServiceOperationType, typeof Truck> = {
  delivery: Truck,
  installation: Wrench,
};

/**
 * Блок «Расходы проекта» в основной таблице спецификации.
 * Каждая операция (доставка/монтаж) — отдельная строка, не SpecItem.
 * Клик по строке открывает существующую модалку редактирования операции.
 */
export const ProjectExpenses = memo(function ProjectExpenses({
  ops,
  onOpen,
}: {
  ops: ServiceOperation[];
  /** Открыть операцию в модалке редактирования. */
  onOpen: (operationId: string) => void;
}) {
  if (ops.length === 0) return null;

  const subtotal = ops.reduce((s, op) => s + op.amount, 0);
  const delivery = ops.filter((o) => o.type === "delivery");
  const installation = ops.filter((o) => o.type === "installation");

  const renderGroup = (type: ServiceOperationType, list: ServiceOperation[]) => {
    const Icon = OP_ICON[type];
    const label = SERVICE_OPERATION_CONFIG[type].label;
    const sum = list.reduce((s, op) => s + op.amount, 0);

    return (
      <div className="mt-4">
        <div className="flex items-center gap-2">
          <Icon className="size-4 text-fg-secondary" />
          <span className="font-mono text-[12px] font-semibold uppercase tracking-[.08em] text-fg-secondary">
            {label}
          </span>
          <span className="rounded-full border border-border-muted px-2 py-0.5 text-[11px] text-fg-muted">
            {list.length}{" "}
            {plural(list.length, "операция", "операции", "операций")}
          </span>
          <span className="ml-auto font-mono text-[12.5px] font-semibold tabular-nums text-fg-secondary">
            {sum > 0 ? `${fmt(sum)} ₽` : ""}
          </span>
        </div>

        {list.length === 0 ? (
          <p className="mt-1.5 rounded-xl border border-dashed border-border-muted px-3 py-2.5 text-[12.5px] leading-relaxed text-fg-muted">
            Операций «{label}» пока нет. Выделите позиции и нажмите «{label}»
            на нижней панели.
          </p>
        ) : (
          <div className="mt-1.5 overflow-hidden rounded-xl border border-border-muted bg-bg-card">
            {list.map((op) => (
              <button
                key={op.id}
                type="button"
                onClick={() => onOpen(op.id)}
                aria-label={`Редактировать ${label.toLowerCase()} · ${fmt(op.amount)} ₽`}
                className="group flex w-full flex-col gap-1 border-t border-border-muted px-3 py-2.5 text-left transition-colors first:border-t-0 hover:bg-bg-card2"
              >
                <span className="flex min-w-0 items-center gap-2.5">
                  <span className="min-w-0 truncate text-[13.5px] font-semibold text-fg">
                    {label}
                  </span>

                  {type === "delivery" && (
                    <span
                      className={
                        op.completed
                          ? "inline-flex shrink-0 items-center rounded-full border border-emerald-700/30 bg-emerald-700/12 px-2 py-0.5 text-[11px] font-medium text-emerald-700"
                          : "inline-flex shrink-0 items-center rounded-full border border-border-muted bg-bg-card2 px-2 py-0.5 text-[11px] text-fg-muted"
                      }
                    >
                      {op.completed ? "Исполнено" : "Не исполнено"}
                    </span>
                  )}

                  <span className="ml-auto shrink-0 font-mono text-[13.5px] font-semibold tabular-nums text-fg">
                    {fmt(op.amount)} ₽
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-fg-muted transition-transform group-hover:translate-x-0.5" />
                </span>

                <span className="flex flex-wrap items-center gap-x-4 gap-y-0.5 text-[12px] text-fg-muted">
                  {op.spec_item_ids.length > 0 && (
                    <span className="font-mono tabular-nums">
                      {op.spec_item_ids.length}{" "}
                      {plural(
                        op.spec_item_ids.length,
                        "позиция",
                        "позиции",
                        "позиций",
                      )}
                    </span>
                  )}
                  {op.deadline && (
                    <span className="font-mono tabular-nums">
                      до {dateLabel(op.deadline)}
                    </span>
                  )}
                  {op.contractor_name && (
                    <span
                      className="min-w-0 max-w-full truncate"
                      title={op.contractor_name}
                    >
                      Подрядчик: {op.contractor_name}
                    </span>
                  )}
                  {op.notes && (
                    <span
                      className="min-w-0 flex-1 truncate text-fg-dim"
                      title={op.notes}
                    >
                      {op.notes}
                    </span>
                  )}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <section className="mt-6">
      <div className="flex items-center gap-3 border-b border-fg pb-2">
        <h3 className="font-mono text-[13px] font-semibold uppercase tracking-wide">
          Расходы проекта
        </h3>
        <span className="rounded-full border border-border-muted px-2 py-0.5 text-[11px] text-fg-muted">
          {ops.length} {plural(ops.length, "операция", "операции", "операций")}
        </span>
        <span className="ml-auto font-mono text-[13.5px] font-semibold tabular-nums">
          {subtotal > 0 ? `${fmt(subtotal)} ₽` : ""}
        </span>
      </div>

      {renderGroup("delivery", delivery)}
      {renderGroup("installation", installation)}
    </section>
  );
});
