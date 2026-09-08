"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import Field from "@/components/layout/modal-field";
import { SERVICE_OPERATION_CONFIG, type ServiceOperationType } from "@/lib/constants";
import type { SpecPickerCompany } from "@/lib/queries";
import type { SpecBuilderContext } from "@/hooks/use-spec-builder";
import { createServiceOperation } from "@/actions/service-operations";
import { plural } from "@/lib/utils";

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
  ctx,
  companies,
  onClose,
}: {
  type: ServiceOperationType;
  ctx: SpecBuilderContext;
  companies: SpecPickerCompany[];
  onClose: () => void;
}) {
  const label = SERVICE_OPERATION_CONFIG[type].label;

  /** Позиции, участвующие в операции (заглушки исключаются сразу). */
  const eligible = ctx.selectedItems.filter((i) => !i.isPlaceholder);
  const excludedPlaceholders = ctx.selectedItems.length - eligible.length;

  const [amount, setAmount] = useState("");
  const [deadline, setDeadline] = useState("");
  const [contractorCompanyId, setContractorCompanyId] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
    if (eligible.length === 0) {
      setError("Выберите хотя бы одну заполненную позицию");
      return;
    }

    setError(null);
    setBusy(true);
    const res = await createServiceOperation(ctx.orgSlug, ctx.projectId, {
      type,
      specItemIds: eligible.map((i) => i.id),
      amount: value,
      deadline: deadline || null,
      contractorCompanyId: contractorCompanyId || null,
      notes,
    });
    setBusy(false);
    if (!res.success) {
      setError(res.error);
      return;
    }
    ctx.onOperationCreated(res.data);
  };

  return (
    <Dialog open onOpenChange={(v) => !v && !busy && onClose()}>
      <DialogContent className="flex max-h-[92vh] flex-col gap-0 overflow-hidden rounded-[22px] bg-bg p-0 sm:max-w-140">
        <DialogHeader className="flex-row items-center justify-between gap-3 border-b border-border-subtle px-5 py-4">
          <DialogTitle className="text-[19px] font-bold tracking-[-.01em]">
            {label}
            <span className="ml-2 font-mono text-[12px] font-medium uppercase tracking-[.08em] text-fg-muted">
              доп. расход · {eligible.length}{" "}
              {plural(eligible.length, "позиция", "позиции", "позиций")}
            </span>
          </DialogTitle>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {excludedPlaceholders > 0 && (
            <p className="mb-3 rounded-lg border border-border-muted bg-bg-card2 px-3 py-2 text-[12.5px] text-fg-muted">
              Заглушки ({excludedPlaceholders}) в операцию не включаются.
            </p>
          )}

          <Field label="Позиции">
            <div className="max-h-44 overflow-y-auto rounded-lg border border-border-muted bg-bg-card">
              {eligible.map((i) => (
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

        <div className="flex items-center justify-end gap-2 border-t border-border-subtle px-5 py-3">
          <Button variant="outline" size="lg" onClick={onClose} disabled={busy}>
            Отмена
          </Button>
          <Button size="lg" onClick={() => void submit()} disabled={busy}>
            {busy ? (
              <>
                <Loader2 className="size-4 animate-spin" /> Сохраняем…
              </>
            ) : (
              `Добавить ${label.toLowerCase()}`
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
