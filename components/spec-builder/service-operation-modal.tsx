"use client";

import { useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import Field from "@/components/layout/modal-field";
import {
  SERVICE_OPERATION_BLOCKED_STATUSES,
  SERVICE_OPERATION_CONFIG,
  specItemIdsInDeliveries,
  type ServiceOperationType,
} from "@/lib/constants";
import type { SpecPickerCompany } from "@/lib/queries";
import type { SpecBuilderContext } from "@/hooks/use-spec-builder";
import {
  createServiceOperation,
  deleteServiceOperation,
  updateServiceOperation,
  type ServiceOperation,
} from "@/actions/service-operations";
import { fmt, plural } from "@/lib/utils";

/** «12 300,50» и «12300.5» → число; невалидное/пустое → null. */
function parseMoney(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  const n = Number(t.replace(/[^\d.,-]/g, "").replace(",", "."));
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100) / 100;
}

export function ServiceOperationModal({
  type,
  operation,
  ctx,
  companies,
  onClose,
}: {
  type: ServiceOperationType;
  /** Передана — модалка открыта в режиме редактирования существующей операции. */
  operation?: ServiceOperation;
  ctx: SpecBuilderContext;
  companies: SpecPickerCompany[];
  onClose: () => void;
}) {
  const label = SERVICE_OPERATION_CONFIG[type].label;
  const isEdit = !!operation;

  /**
   * Позиции, участвующие в НОВОЙ операции. Сразу исключаются заглушки,
   * материалы с недоступным статусом («Доставлено»/«Заменить» для доставки,
   * «Заменить» для монтажа) и — только для доставки — материалы, которые уже
   * включены в другую доставку (независимо от их текущего статуса).
   */
  const selectedReal = ctx.selectedItems.filter((i) => !i.isPlaceholder);
  const excludedPlaceholders = ctx.selectedItems.length - selectedReal.length;
  const forbiddenStatuses = SERVICE_OPERATION_BLOCKED_STATUSES[type];
  const byStatus = selectedReal.filter(
    (i) => !forbiddenStatuses.includes(i.status),
  );
  const excludedByStatus = selectedReal.length - byStatus.length;

  /** Материалы, уже связанные с другой доставкой, в новую доставку не берём. */
  const otherDeliveryIds =
    type === "delivery"
      ? specItemIdsInDeliveries(ctx.operations)
      : new Set<string>();
  const eligible = byStatus.filter((i) => !otherDeliveryIds.has(i.id));
  const excludedByLinked = byStatus.length - eligible.length;

  /** В режиме редактирования показываем позиции, уже связанные с операцией. */
  const linkedItems = operation
    ? ctx.items.filter((i) => operation.spec_item_ids.includes(i.id))
    : eligible;
  const count = operation ? operation.spec_item_ids.length : linkedItems.length;

  /** Среди связанных есть позиция со статусом «Заменить». */
  const hasReplaceLinked = linkedItems.some((i) => i.status === "replace");

  /** Пояснение при создании, если часть выделенных позиций исключена. */
  const excludedNote =
    !operation &&
    (excludedPlaceholders > 0 || excludedByStatus > 0 || excludedByLinked > 0)
      ? [
          excludedPlaceholders > 0
            ? `заглушки (${excludedPlaceholders})`
            : "",
          excludedByStatus > 0
            ? type === "delivery"
              ? `материалы со статусом «Доставлено»/«Заменить» (${excludedByStatus})`
              : `материалы со статусом «Заменить» (${excludedByStatus})`
            : "",
          excludedByLinked > 0
            ? type === "delivery"
              ? `материалы из другой доставки (${excludedByLinked})`
              : ""
            : "",
        ]
          .filter(Boolean)
          .join(" и ")
      : null;

  const [amount, setAmount] = useState(
    operation ? String(operation.amount) : "",
  );
  const [deadline, setDeadline] = useState(operation?.deadline ?? "");
  const [contractorCompanyId, setContractorCompanyId] = useState(
    operation?.contractor_company_id ?? "",
  );
  const [notes, setNotes] = useState(operation?.notes ?? "");
  /**
   * Отметка «исполнено» — показывается для доставки.
   * Если связанный материал получил статус «Заменить», отметку автоматически
   * не включаем: материал требует замены, и авто-отметка не должна
   * «возвращать» его в «Доставлено».
   */
  const [completed, setCompleted] = useState(
    operation ? operation.completed && !hasReplaceLinked : false,
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const submit = async () => {
    const value = parseMoney(amount);
    if (value === null) {
      setError("Укажите стоимость");
      return;
    }
    if (value < 0) {
      setError("Стоимость не может быть отрицательной");
      return;
    }
    if (!operation && eligible.length === 0) {
      setError("Выберите хотя бы одну заполненную позицию");
      return;
    }

    setError(null);
    setBusy(true);
    const res = operation
      ? await updateServiceOperation(ctx.orgSlug, ctx.projectId, operation.id, {
          type,
          specItemIds: operation.spec_item_ids,
          amount: value,
          completed,
          deadline: deadline || null,
          contractorCompanyId: contractorCompanyId || null,
          notes,
        })
      : await createServiceOperation(ctx.orgSlug, ctx.projectId, {
          type,
          specItemIds: eligible.map((i) => i.id),
          amount: value,
          completed,
          deadline: deadline || null,
          contractorCompanyId: contractorCompanyId || null,
          notes,
        });
    setBusy(false);
    if (!res.success) {
      setError(res.error);
      return;
    }
    if (operation) ctx.onOperationUpdated(res.data);
    else ctx.onOperationCreated(res.data);
  };

  const remove = async () => {
    if (!operation) return;
    setError(null);
    setDeleting(true);
    const res = await deleteServiceOperation(
      ctx.orgSlug,
      ctx.projectId,
      operation.id,
    );
    setDeleting(false);
    if (!res.success) {
      setError(res.error);
      setConfirmDelete(false);
      return;
    }
    ctx.onOperationDeleted(operation);
  };

  return (
    <Dialog open onOpenChange={(v) => !v && !busy && !deleting && onClose()}>
      <DialogContent className="flex max-h-[92vh] flex-col gap-0 overflow-hidden rounded-[22px] bg-bg p-0 sm:max-w-140">
        <DialogHeader className="flex-row items-center justify-between gap-3 border-b border-border-subtle px-5 py-4">
          <DialogTitle className="text-[19px] font-bold tracking-[-.01em]">
            {isEdit ? `Редактировать · ${label}` : label}
            <span className="ml-2 font-mono text-[12px] font-medium uppercase tracking-[.08em] text-fg-muted">
              доп. расход · {count}{" "}
              {plural(count, "позиция", "позиции", "позиций")}
            </span>
          </DialogTitle>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {excludedNote && (
            <p className="mb-3 rounded-lg border border-border-muted bg-bg-card2 px-3 py-2 text-[12.5px] text-fg-muted">
              {excludedNote} не включаются в операцию.
            </p>
          )}

          <Field label="Позиции">
            <div className="max-h-44 overflow-y-auto rounded-lg border border-border-muted bg-bg-card">
              {linkedItems.map((i) => (
                <div
                  key={i.id}
                  className="flex items-center gap-2 border-b border-border-muted px-2.5 py-1.5 last:border-0"
                >
                  <span className="shrink-0 font-mono text-[11px] text-fg-muted">
                    {i.code}
                  </span>
                  <span className="min-w-0 truncate text-[13px] text-fg-secondary">
                    {i.name}
                  </span>
                </div>
              ))}
            </div>
          </Field>

          <div className="mt-4 grid grid-cols-2 gap-3">
            <Field label="Стоимость, ₽">
              <Input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                inputMode="decimal"
                autoFocus
                placeholder="0"
                className="h-10 bg-bg-card font-mono"
              />
            </Field>
            <Field label="Срок">
              <Input
                type="date"
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
                className="h-10 bg-bg-card font-mono"
              />
            </Field>
          </div>

          <div className="mt-4">
            <Field label="Подрядчик (необязательно)">
              <select
                value={contractorCompanyId}
                onChange={(e) => setContractorCompanyId(e.target.value)}
                className="h-10 w-full rounded-lg border border-border-muted bg-bg-card px-2.5 text-[14px] text-fg outline-none"
              >
                <option value="">Не указан</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          {type === "delivery" && (
            <div className="mt-4 rounded-lg border border-border-muted bg-bg-card2 px-3 py-2.5">
              <label className="flex cursor-pointer items-center gap-2.5">
                <Checkbox
                  checked={completed}
                  onCheckedChange={(v) => setCompleted(v === true)}
                  aria-label="Доставка исполнена"
                />
                <span className="text-[14px] font-semibold text-fg">
                  Исполнено
                </span>
              </label>
              <p className="pl-6 text-[12px] leading-relaxed text-fg-muted">
                При сохранении отметки связанные материалы автоматически
                получат статус «Доставлено». Их стоимость не изменится.
              </p>
              {hasReplaceLinked && (
                <p className="mt-1 pl-6 text-[12px] leading-relaxed text-fg-red">
                  Материалы со статусом «Заменить» доставленными автоматически
                  не отмечаются.
                </p>
              )}
            </div>
          )}

          <div className="mt-4">
            <Field label="Комментарий (необязательно)">
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                placeholder="Например: монтаж в течение двух недель после поставки"
                className="resize-none bg-bg-card"
              />
            </Field>
          </div>

          <p className="mt-3 text-[12px] leading-relaxed text-fg-muted">
            Стоимость операции добавляется к смете один раз целиком и не
            распределяется между выбранными позициями.
          </p>

          {error && (
            <p
              role="alert"
              className="mt-3 rounded-lg border border-border-red bg-bg-red-light px-3 py-2 text-[13px] text-fg-red"
            >
              {error}
            </p>
          )}
        </div>

        {confirmDelete && operation ? (
          <div className="flex flex-col gap-3 border-t border-border-red bg-bg-red-light px-5 py-4">
            <p className="text-[14px] font-semibold leading-snug text-fg-red">
              Удалить операцию «{label} · {fmt(operation.amount)} ₽»?
            </p>
            <p className="text-[13px] leading-relaxed text-fg-secondary">
              Операция будет удалена вместе со всеми её связями с позициями
              спецификации. Связанные материалы не удаляются, и их стоимость
              не изменится.
            </p>
            <div className="flex items-center justify-end gap-2">
              <Button
                variant="outline"
                size="lg"
                onClick={() => setConfirmDelete(false)}
                disabled={deleting}
              >
                Отмена
              </Button>
              <Button
                variant="destructive"
                size="lg"
                onClick={() => void remove()}
                disabled={deleting}
              >
                {deleting ? (
                  <>
                    <Loader2 className="size-4 animate-spin" /> Удаляем…
                  </>
                ) : (
                  <>
                    <Trash2 className="size-4" /> Удалить
                  </>
                )}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-end gap-2 border-t border-border-subtle px-5 py-3">
            {operation && (
              <Button
                variant="ghost"
                size="lg"
                onClick={() => {
                  setError(null);
                  setConfirmDelete(true);
                }}
                disabled={busy || deleting}
                className="mr-auto gap-2 text-fg-red"
              >
                <Trash2 className="size-4" /> Удалить
              </Button>
            )}
            <Button
              variant="outline"
              size="lg"
              onClick={onClose}
              disabled={busy || deleting}
            >
              Отмена
            </Button>
            <Button
              size="lg"
              onClick={() => void submit()}
              disabled={busy || deleting}
            >
              {busy ? (
                <>
                  <Loader2 className="size-4 animate-spin" /> Сохраняем…
                </>
              ) : operation ? (
                "Сохранить"
              ) : (
                `Добавить ${label.toLowerCase()}`
              )}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
