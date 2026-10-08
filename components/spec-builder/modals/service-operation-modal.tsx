"use client";

import { useState } from "react";
import { Building2, Loader2, Trash2 } from "lucide-react";
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
import { CompanyDialog } from "@/components/contacts/company-dialog";
import { ServiceTypeCombobox } from "@/components/spec-builder/layout/add-service-combobox";
import {
  SERVICE_OPERATION_BLOCKED_STATUSES,
  operationLabel,
  specItemIdsInDeliveries,
  specItemIdsInInstallations,
  type ServiceOperationType,
} from "@/lib/constants";
import type { SpecPickerCompany } from "@/lib/queries";
import type { SpecBuilderContext } from "@/hooks/use-spec-builder";
import type { ServiceOperationFields } from "@/lib/validations";
import { SPEC_STATUS_CONFIG } from "@/lib/spec/status";
import {
  serviceTypeCreateLabel,
  type ServiceTypePick,
} from "@/lib/spec/service-type";
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
  preselectedItemIds,
  initialName,
  ctx,
  companies,
  onClose,
}: {
  /** Начальный тип услуги. Дальше тип — обычное поле формы и меняется в ней. */
  type: ServiceOperationType;
  /** Передана — модалка открыта в режиме редактирования существующей операции. */
  operation?: ServiceOperation;
  /**
   * Создание из карточки позиции: эти позиции уже участвуют в операции.
   * Из выделения в таблице список приходит пустым — берём выделение.
   */
  preselectedItemIds?: string[];
  /**
   * Черновик названия своей услуги. Приходит из Createable Combobox карточки
   * материала: пользователь уже набрал название, и вводить его второй раз не
   * нужно. Поле остаётся обычным — название можно исправить.
   */
  initialName?: string | null;
  ctx: SpecBuilderContext;
  companies: SpecPickerCompany[];
  onClose: () => void;
}) {
  const isEdit = !!operation;
  /**
   * Тип услуги выбирается в форме (`ServiceTypeCombobox` в поле «Тип услуги»).
   * Тип определяет подпись, наличие названия, доступные материалы и отметку
   * «Исполнено», поэтому дальше по коду используется только он, а не проп.
   */
  const [currentType, setCurrentType] = useState<ServiceOperationType>(type);
  const isService = currentType === "service";
  const isDelivery = currentType === "delivery";
  /**
   * Название своей услуги — её подпись во всех списках и в смете. У «Доставки»
   * и «Монтажа» подпись фиксирована, поэтому поля нет. Значение сохраняется при
   * переключении типа: вернувшись к своей услуге, пользователь находит прежний
   * текст, а не пустое поле.
   */
  const [name, setName] = useState(operation?.name ?? initialName ?? "");
  const label = operationLabel({ type: currentType, name });
  const title = isEdit
    ? `Редактировать · ${label}`
    : isService
      ? "Новая услуга"
      : label;

  /**
   * Позиции, участвующие в НОВОЙ операции. Сразу исключаются заглушки,
   * материалы с недоступным статусом («Доставлено»/«Заменить» для доставки,
   * «Заменить» для монтажа) и материалы, которые уже включены в другую
   * операцию того же типа — в другую доставку или в другой монтаж
   * (независимо от их текущего статуса). Доставка и монтаж независимы:
   * материал из доставки доступен для монтажа и наоборот.
   *
   * У своих услуг ограничений по статусу нет, и они необязательны: услуга
   * может быть расходом проекта целиком.
   *
   * Всё считается от ВЫБРАННОГО типа: смена типа в форме сразу пересчитывает
   * список и пояснение к нему.
   */
  const preselected = preselectedItemIds?.length
    ? ctx.items.filter((i) => preselectedItemIds.includes(i.id))
    : ctx.selectedItems;
  const selectedReal = preselected.filter((i) => !i.isPlaceholder);
  const excludedPlaceholders = preselected.length - selectedReal.length;
  const forbiddenStatuses = SERVICE_OPERATION_BLOCKED_STATUSES[currentType];
  const byStatus = selectedReal.filter(
    (i) => !forbiddenStatuses.includes(i.status),
  );
  const excludedByStatus = selectedReal.length - byStatus.length;

  /**
   * Материалы, уже связанные с другой операцией того же типа, не берём.
   * У своих услуг правила «один раз» нет: позицию можно привязать к
   * нескольким услугам. Собственная операция (режим редактирования) «другой»
   * не считается.
   */
  const otherLinkedIds =
    currentType === "delivery"
      ? specItemIdsInDeliveries(
          ctx.operations.filter((o) => o.id !== operation?.id),
        )
      : currentType === "installation"
        ? specItemIdsInInstallations(
            ctx.operations.filter((o) => o.id !== operation?.id),
          )
        : new Set<string>();
  const eligible = byStatus.filter((i) => !otherLinkedIds.has(i.id));
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
            ? `материалы со статусом ${
                forbiddenStatuses.length > 1
                  ? forbiddenStatuses
                      .map((s) => `«${SPEC_STATUS_CONFIG[s].label}»`)
                      .join("/")
                  : `«${SPEC_STATUS_CONFIG[forbiddenStatuses[0]].label}»`
              } (${excludedByStatus})`
            : "",
          excludedByLinked > 0
            ? currentType === "delivery"
              ? `материалы из другой доставки (${excludedByLinked})`
              : `материалы из другого монтажа (${excludedByLinked})`
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
   * Отметка «исполнено» — у всех типов: закрыть работу можно и у монтажа, и у
   * своей услуги. Следствие отметки есть только у доставки (материалы
   * становятся «Доставлено»).
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
  /** Карточка выбранного подрядчика — открывается поверх модалки операции. */
  const [showContractorCard, setShowContractorCard] = useState(false);
  const contractorCompany =
    companies.find((c) => c.id === contractorCompanyId) ?? null;

  /**
   * Свои услуги, уже созданные в проекте: подсказки в поле типа и защита от
   * дубликата по названию. Текущая операция исключается — её собственное
   * название не должно выглядеть как «уже существует».
   */
  const usedCustomNames = ctx.operations
    .filter((o) => o.type === "service" && o.id !== operation?.id)
    .map((o) => o.name?.trim() ?? "")
    .filter(Boolean);

  /**
   * Смена типа в форме. Меняются только последствия типа: подпись, поля и
   * список позиций (он вычисляется из `currentType`). Уже введённые стоимость,
   * срок, подрядчик, комментарий и отметка «Исполнено» остаются — они не
   * зависят от типа: закрыть работу можно у любой операции.
   */
  const applyTypePick = (pick: ServiceTypePick) => {
    const next: ServiceOperationType =
      pick.kind === "fixed" ? pick.type : "service";
    setError(null);
    setCurrentType(next);
    // Название, набранное в поле типа, становится названием услуги: для
    // пользователя это одно действие «создать «Подъём на этаж»».
    if (pick.kind === "custom" && pick.name) setName(pick.name);
  };

  const submit = async () => {
    const trimmedName = name.trim();
    if (isService && !trimmedName) {
      setError("Укажите название услуги");
      return;
    }

    const value = parseMoney(amount);
    if (value === null) {
      setError("Укажите стоимость");
      return;
    }
    if (value < 0) {
      setError("Стоимость не может быть отрицательной");
      return;
    }
    // Своя услуга может быть расходом проекта целиком — позиции необязательны.
    if (!operation && !isService && eligible.length === 0) {
      setError("Выберите хотя бы одну заполненную позицию");
      return;
    }

    setError(null);
    setBusy(true);
    // При редактировании список позиций сохраняется как есть: менять его здесь
    // нечем, а «Доставка»/«Монтаж» не могут остаться без позиций.
    const specItemIds = operation
      ? operation.spec_item_ids
      : eligible.map((i) => i.id);
    const shared = {
      specItemIds,
      amount: value,
      completed,
      deadline: deadline || null,
      contractorCompanyId: contractorCompanyId || null,
      notes,
    };
    // Название — только у своей услуги; тип сужает дискриминированный union.
    // Тип берётся из поля формы: пользователь мог сменить его здесь же.
    const input: ServiceOperationFields = isService
      ? { ...shared, type: "service", name: trimmedName }
      : { ...shared, type: currentType, name: null };

    const res = operation
      ? await updateServiceOperation(
          ctx.orgSlug,
          ctx.projectId,
          operation.id,
          input,
        )
      : await createServiceOperation(ctx.orgSlug, ctx.projectId, input);
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
      <DialogContent className="max-h-[92vh] gap-0 overflow-hidden rounded-[22px] bg-bg p-0 sm:max-w-140">
        <DialogHeader className="flex-row items-center justify-between gap-3 border-b border-border-subtle px-5 py-4">
          <DialogTitle className="text-[19px] font-bold tracking-[-.01em]">
            {title}
            <span className="ml-2 font-mono text-[12px] font-medium uppercase tracking-[.08em] text-fg-muted">
              {/* У своей услуги позиции необязательны — «0 позиций» звучало бы
                  как незаполненная форма, поэтому пишем, что это расход проекта. */}
              {isService && count === 0
                ? "расход проекта"
                : `доп. расход · ${count} ${plural(count, "позиция", "позиции", "позиций")}`}
            </span>
          </DialogTitle>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {/*
            Тип услуги — первое поле формы. Он определяет всё остальное: подпись
            в заголовке, наличие названия, список позиций и отметку «Исполнено».
            Один и тот же диалог создаёт и «Доставку», и «Монтаж», и свою услугу.
          */}
          <div className="mb-4">
            <Field label="Тип услуги">
              <ServiceTypeCombobox
                type={currentType}
                onChange={applyTypePick}
                usedCustomNames={usedCustomNames}
                disabled={busy || deleting}
              />
            </Field>
          </div>

          {isService && (
            <div className="mb-4">
              <Field label="Название услуги">
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  // Тип уже выбран; при своей услуге сразу вводится название.
                  autoFocus
                  maxLength={200}
                  placeholder="Подъём на этаж, хранение на складе…"
                  className="h-10 bg-bg-card"
                />
              </Field>
            </div>
          )}

          {excludedNote && (
            <p className="mb-3 rounded-lg border border-border-muted bg-bg-card2 px-3 py-2 text-[12.5px] text-fg-muted">
              {excludedNote} не включаются в операцию.
            </p>
          )}

          <Field label={isService ? "Позиции (необязательно)" : "Позиции"}>
            <div className="max-h-44 overflow-y-auto rounded-lg border border-border-muted bg-bg-card">
              {linkedItems.length === 0 && (
                <p className="px-2.5 py-2 text-[12.5px] text-fg-muted">
                  {isService
                    ? "Позиции не выбраны: услуга будет учтена в расходах проекта целиком."
                    : "Позиции не выбраны"}
                </p>
              )}
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
                // У своей услуги фокус уже стоит в поле названия.
                autoFocus={!isService}
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
              <div className="flex items-center gap-2">
                <select
                  value={contractorCompanyId}
                  onChange={(e) => setContractorCompanyId(e.target.value)}
                  className="h-10 min-w-0 flex-1 rounded-lg border border-border-muted bg-bg-card px-2.5 text-[14px] text-fg outline-none"
                >
                  <option value="">Не указан</option>
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                {contractorCompany && (
                  <Button
                    type="button"
                    variant="outline"
                    size="lg"
                    onClick={() => setShowContractorCard(true)}
                    disabled={busy || deleting}
                    className="shrink-0 gap-1.5"
                  >
                    <Building2 className="size-4" /> Карточка
                  </Button>
                )}
              </div>
            </Field>
          </div>

          {/*
            Отметка «Исполнено» есть у всех типов: закрыть работу можно и у
            монтажа, и у своей услуги — иначе у операции со сроком нечем снять
            просрочку. Следствие отметки зависит от типа: «Доставлено» получают
            только материалы доставки.
          */}
          <div className="mt-4 rounded-lg border border-border-muted bg-bg-card2 px-3 py-2.5">
            <label className="flex cursor-pointer items-center gap-2.5">
              <Checkbox
                checked={completed}
                onCheckedChange={(v) => setCompleted(v === true)}
                aria-label="Исполнено"
              />
              <span className="text-[14px] font-semibold text-fg">
                Исполнено
              </span>
            </label>
            <p className="pl-6 text-[12px] leading-relaxed text-fg-muted">
              {isDelivery
                ? "При сохранении отметки связанные материалы автоматически получат статус «Доставлено». Их стоимость не изменится."
                : "Отметка закрывает операцию: срок перестаёт считаться просроченным. Статусы материалов не меняются."}
            </p>
            {isDelivery && hasReplaceLinked && (
              <p className="mt-1 pl-6 text-[12px] leading-relaxed text-fg-red">
                Материалы со статусом «Заменить» доставленными автоматически
                не отмечаются.
              </p>
            )}
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
                // Подпись зависит от выбранного в форме типа: у услуги «Создать
                // услугу», у доставки и монтажа — свой винительный падеж
                // (см. serviceTypeCreateLabel).
                serviceTypeCreateLabel(currentType)
              )}
            </Button>
          </div>
        )}
      </DialogContent>

      {contractorCompany && showContractorCard && (
        <CompanyDialog
          orgSlug={ctx.orgSlug}
          open={showContractorCard}
          company={contractorCompany}
          onClose={() => setShowContractorCard(false)}
        />
      )}
    </Dialog>
  );
}
