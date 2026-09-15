"use client";

import { Truck, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  SERVICE_OPERATION_CONFIG,
  type ServiceOperationType,
} from "@/lib/constants";
import { fmt } from "@/lib/utils";
import type { ServiceOperation } from "@/actions/service-operations";

function dateLabel(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("ru-RU");
}

function OperationCard({
  type,
  op,
  onOpen,
}: {
  type: ServiceOperationType;
  op?: ServiceOperation;
  onOpen: (operationId: string) => void;
}) {
  const label = SERVICE_OPERATION_CONFIG[type].label;
  const Icon = type === "installation" ? Wrench : Truck;

  return (
    <div className="flex flex-col rounded-xl border border-border-muted bg-bg-card p-3">
      <div className="flex items-center gap-2">
        <span className="flex size-7 items-center justify-center rounded-lg border border-border-muted bg-bg-card2 text-fg-secondary">
          <Icon className="size-4" />
        </span>
        <span className="font-mono text-[12px] font-semibold uppercase tracking-[.08em] text-fg-secondary">
          {label}
        </span>
      </div>

      {op ? (
        <>
          <div className="mt-2 font-mono text-[18px] font-bold tabular-nums">
            {fmt(op.amount)} ₽
          </div>
          {op.deadline && (
            <p className="mt-1 font-mono text-[12px] text-fg-muted tabular-nums">
              срок: до {dateLabel(op.deadline)}
            </p>
          )}
          {op.contractor_name && (
            <p
              className="mt-1 truncate text-[12.5px] text-fg-secondary"
              title={op.contractor_name}
            >
              Подрядчик: {op.contractor_name}
            </p>
          )}
          {op.notes && (
            <p className="mt-1 line-clamp-2 text-[12.5px] leading-snug text-fg-muted">
              {op.notes}
            </p>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpen(op.id)}
            className="mt-3 self-start"
          >
            Подробнее
          </Button>
        </>
      ) : (
        <p className="mt-2 text-[13px] text-fg-muted">{label} не назначен</p>
      )}
    </div>
  );
}

/**
 * Карточки операций «Монтаж» и «Доставка» для модалки детализации позиции.
 * Показывают назначенную операцию (сумма, срок, подрядчик, заметки) либо
 * компактное состояние «не назначен». Ссылки на модалку редактирования
 * передаются извне — здесь никакой загрузки/сохранения нет.
 */
export function ServiceOperationDetailCards({
  ops,
  onOpenOperation,
}: {
  /** Операции, привязанные к текущей позиции. */
  ops: ServiceOperation[];
  /** Открыть операцию в существующей модалке редактирования. */
  onOpenOperation: (operationId: string) => void;
}) {
  const opByType = (type: ServiceOperationType) =>
    ops.find((o) => o.type === type);

  return (
    <section className="border-t border-border-muted px-4 py-4">
      <h4 className="text-[14px] font-bold text-fg">Монтаж и доставка</h4>
      <div className="mt-2 grid gap-3 sm:grid-cols-2">
        <OperationCard
          type="installation"
          op={opByType("installation")}
          onOpen={onOpenOperation}
        />
        <OperationCard
          type="delivery"
          op={opByType("delivery")}
          onOpen={onOpenOperation}
        />
      </div>
    </section>
  );
}
