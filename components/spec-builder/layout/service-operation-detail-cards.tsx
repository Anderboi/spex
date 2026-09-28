"use client";

import {
  Building2,
  Clock,
  ConciergeBell,
  Plus,
  Truck,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  operationLabel,
  type ServiceOperationType,
} from "@/lib/constants";
import { fmt } from "@/lib/utils";
import type { ServiceOperation } from "@/actions/service-operations";
import ModalBlockLabel from "@/components/layout/modal-block-label";

const ICON_BY_TYPE: Record<ServiceOperationType, LucideIcon> = {
  delivery: Truck,
  installation: Wrench,
  service: ConciergeBell,
};

/** Срок — «сегодня», «просрочено N дн.» или «через N дн.» от даты-строки. */
function deadlineNote(iso: string): { text: string; overdue: boolean } {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(`${iso}T00:00:00`);
  const days = Math.round((due.getTime() - today.getTime()) / 86_400_000);

  if (days === 0) return { text: "сегодня", overdue: false };
  if (days < 0) return { text: `просрочено ${-days} дн.`, overdue: true };
  return { text: `через ${days} дн.`, overdue: false };
}

/**
 * Строка услуги в блоке «Обзор». Высота фиксирована (h-11), поэтому список
 * читается как таблица и не «прыгает» при появлении срока или подрядчика.
 * Операция всегда открывается целиком в своей модалке: здесь только состояние.
 */
function ServiceRow({
  op,
  onOpen,
}: {
  op: ServiceOperation;
  onOpen: (operationId: string) => void;
}) {
  const Icon = ICON_BY_TYPE[op.type];
  const label = operationLabel(op);
  const deadline = op.deadline ? deadlineNote(op.deadline) : null;

  return (
    <button
      type="button"
      onClick={() => onOpen(op.id)}
      title={`Открыть «${label}»`}
      className="flex h-11 w-full items-center gap-2.5 px-2 text-left transition-colors hover:bg-bg-card2"
    >
      <Icon className="size-3.5 shrink-0 text-fg-muted" />

      <span className="min-w-0 truncate text-[13px] font-medium text-fg">
        {label}
      </span>

      {/* Доставка отмечается исполненной — это меняет статусы материалов. */}
      {op.type === "delivery" && (
        <span
          className={
            "shrink-0 rounded-full px-1.5 py-0.5 font-mono text-[10px] " +
            (op.completed
              ? "bg-bg-green-light text-fg-green"
              : "bg-bg-card2 text-fg-dim")
          }
        >
          {op.completed ? "исполнена" : "не исполнена"}
        </span>
      )}

      {/* Срок и подрядчик — только когда они есть: пустые подписи в строке
          не нужны, а отсутствие даты и так видно по модалке. */}
      {deadline && (
        <span
          className={
            "hidden shrink-0 items-center gap-1 font-mono text-[11.5px] sm:flex " +
            (deadline.overdue ? "text-fg-red" : "text-fg-muted")
          }
        >
          <Clock className="size-3" />
          {deadline.text}
        </span>
      )}
      {op.contractor_name && (
        <span className="hidden min-w-0 max-w-[38%] shrink-0 items-center gap-1 text-[11.5px] text-fg-muted sm:flex">
          <Building2 className="size-3 shrink-0" />
          <span className="truncate">{op.contractor_name}</span>
        </span>
      )}

      <span className="ml-auto shrink-0 font-mono text-[13px] font-semibold tabular-nums text-fg">
        {fmt(op.amount)} ₽
      </span>
    </button>
  );
}

/**
 * Услуги позиции: «Доставка», «Монтаж» и свои услуги. Строки компактные —
 * состояние читается в одну строку, а вся правка живёт в модалке операции.
 * «Добавить услугу» создаёт свою услугу и сразу привязывает её к этой позиции.
 */
export function ServiceOperationDetailCards({
  ops,
  onOpenOperation,
  onAddService,
}: {
  /** Операции, привязанные к текущей позиции. */
  ops: ServiceOperation[];
  /** Открыть операцию в существующей модалке редактирования. */
  onOpenOperation: (operationId: string) => void;
  /** Создать свою услугу; не передан — кнопка не показывается. */
  onAddService?: () => void;
}) {
  const byType = (type: ServiceOperationType) =>
    ops.find((o) => o.type === type);
  // Своих услуг может быть несколько — показываем все.
  const own = ops.filter((o) => o.type === "service");
  const fixed = [byType("delivery"), byType("installation")].filter(
    (o): o is ServiceOperation => o !== undefined,
  );
  const total = ops.reduce((sum, o) => sum + o.amount, 0);

  return (
    <section className="border-t border-border-muted pt-4">
      <div className="flex items-baseline gap-3">
        <ModalBlockLabel>Услуги</ModalBlockLabel>
        <span className="ml-auto font-mono text-[13px] font-semibold tabular-nums text-fg">
          {total > 0 ? `${fmt(total)} ₽` : ""}
        </span>
      </div>

      {ops.length === 0 ? (
        <p className="mt-2 rounded-xl border border-dashed border-border-muted px-3 py-2.5 text-[12.5px] leading-relaxed text-fg-muted">
          Услуг по позиции нет. Доставка и монтаж оформляются на выделенные
          позиции, а свою услугу — например, подъём на этаж — можно добавить
          здесь.
        </p>
      ) : (
        <div className="mt-2 divide-y divide-border-muted overflow-hidden rounded-xl border border-border-muted bg-bg-card">
          {fixed.map((op) => (
            <ServiceRow key={op.id} op={op} onOpen={onOpenOperation} />
          ))}
          {own.map((op) => (
            <ServiceRow key={op.id} op={op} onOpen={onOpenOperation} />
          ))}
        </div>
      )}

      {onAddService && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onAddService}
          className="mt-2 gap-1.5"
        >
          <Plus className="size-3.5" /> Добавить услугу
        </Button>
      )}
    </section>
  );
}
