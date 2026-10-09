"use client";

import { useCallback, useState } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import Field from "@/components/layout/modal-field";
import { PAYMENT_LIMITS } from "@/lib/validations";
import { fmtRub } from "@/lib/utils";
import type { PaymentPlanEntry } from "@/lib/spec/payment-plan-types";
import type { PaymentEntry, PaymentRecordKind } from "@/lib/spec/payment-types";

/**
 * Форма фактической оплаты: внесение и правка одной и той же разметкой.
 *
 * ── Почему форма отдельным компонентом ─────────────────────────────────────
 *
 * Поля, их проверка на клиенте и состояние отправки не должны жить в списке:
 * список отвечает за обновление данных, форма — за ввод. Родитель монтирует её с
 * `key` по открытой записи, поэтому каждое открытие начинает с чистого
 * состояния, а сбрасывать поля эффектом не приходится.
 *
 * ── Что проверяет клиент, а что сервер ─────────────────────────────────────
 *
 * Клиент проверяет только очевидное: сумма — положительное число, длины в
 * пределах лимитов. Права, принадлежность позиции, вид записи и запись в БД —
 * сервер, и его текст отказа показывается как есть: второй, расходящейся
 * валидации здесь нет (то же правило, что у формы графика).
 *
 * ── Вид записи ─────────────────────────────────────────────────────────────
 *
 * В этой задаче форма создаёт только оплату: выбор «оплата или возврат» —
 * следующая задача про возвраты (тикет 03). Значение вида всё равно уходит на
 * сервер ВСЕГДА и хранится в БД с первой записи: иначе возвраты потребовали бы
 * миграции данных, а идемпотентность «повтор с другим видом — другой платёж» не
 * проверялась бы вовсе.
 *
 * ── Ключ идемпотентности ───────────────────────────────────────────────────
 *
 * Приходит пропсом от родителя: он генерирует ключ НА ОТКРЫТИЕ формы и держит
 * его, пока форма открыта. Поэтому двойное нажатие и ретрай отправляют тот же
 * ключ, и второй оплаты не появляется. Форма не имеет права генерировать ключ
 * сама при каждой отправке — тогда защита не работала бы вовсе.
 *
 * ── Строка графика ─────────────────────────────────────────────────────────
 *
 * Селект «без плана» — обычное значение, а не «не заполнено»: оплата без плана
 * разрешена и считается отдельно. Удалённая строка в списке не появляется —
 * привязать оплату к ней нельзя (ядро отказывает), и предлагать такой выбор
 * значило бы обещать недоступное.
 */

/** Данные записи в том виде, в каком их принимает действие. */
export type PaymentFormValues = {
  kind: PaymentRecordKind;
  amount: number;
  paidAt: string | null;
  paymentPlanId: string | null;
  comment: string | null;
};

export default function PaymentForm({
  open,
  payment,
  plans,
  /** Дата по умолчанию для новой записи: 'YYYY-MM-DD'. */
  defaultPaidAt,
  onClose,
  onSubmit,
}: {
  open: boolean;
  /** Редактируемая запись; `null` — создание новой. */
  payment: PaymentEntry | null;
  /** График позиции: варианты привязки. Пустой список — плана ещё нет. */
  plans: PaymentPlanEntry[];
  /** Дата новой записи. Приходит от родителя: он один знает «сегодня» экрана. */
  defaultPaidAt: string;
  /** Закрыть без сохранения: отмена, крестик, успех. */
  onClose: () => void;
  /**
   * Сохранить. Возвращает текст ошибки или `null` при успехе: серверный отказ
   * показывается здесь, а закрывает форму родитель — он же обновляет список
   * записанной строкой.
   */
  onSubmit: (values: PaymentFormValues) => Promise<string | null>;
}) {
  /** Сумма — строкой: «12 000,5» и «12000.5» должны вводиться одинаково свободно. */
  const [amount, setAmount] = useState(payment ? String(payment.amount) : "");
  // Дата по умолчанию — сегодня. Считает её родитель и передаёт пропсом: модуль
  // с арифметикой дат (`lib/spec/payment-mutations`) тянет типы Supabase, и
  // импортировать его ради одной строки в клиентский компонент не нужно.
  const [paidAt, setPaidAt] = useState(payment?.paidAt ?? defaultPaidAt);
  /** Пустая строка — «без плана»: у селекта это значение, а не отсутствие выбора. */
  const [planId, setPlanId] = useState(payment?.paymentPlanId ?? "");
  const [comment, setComment] = useState(payment?.comment ?? "");

  const [clientError, setClientError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = useCallback(async () => {
    setServerError(null);

    // Вид записи при правке не меняется: сервер это запрещает, и форма не
    // подменяет запрет своей догадкой.
    const kind: PaymentRecordKind = payment?.kind ?? "payment";

    // Запятая как десятичный разделитель: так сумму вводят в русской раскладке,
    // и отвергать её значило бы заставлять пользователя переучиваться.
    const parsedAmount = Number(amount.trim().replace(",", "."));
    if (amount.trim().length === 0 || !Number.isFinite(parsedAmount)) {
      setClientError("Укажите сумму");
      return;
    }
    if (parsedAmount <= 0) {
      setClientError("Сумма должна быть больше нуля");
      return;
    }
    if (parsedAmount > PAYMENT_LIMITS.amountMax) {
      setClientError("Слишком большая сумма");
      return;
    }

    const trimmedComment = comment.trim();
    if (trimmedComment.length > PAYMENT_LIMITS.commentMax) {
      setClientError("Комментарий слишком длинный");
      return;
    }

    setClientError(null);
    setSaving(true);

    try {
      const error = await onSubmit({
        kind,
        amount: parsedAmount,
        // Пустая дата — «сегодня»: сервер подставляет тот же день, что и
        // `paid_at default current_date`, а подставлять дату за пользователя
        // форма не имеет права.
        paidAt: paidAt.length > 0 ? paidAt : null,
        // Пустое значение — «без плана», а не пустая строка: в БД у этого
        // состояния одно представление (`null`).
        paymentPlanId: planId.length > 0 ? planId : null,
        comment: trimmedComment.length > 0 ? trimmedComment : null,
      });
      if (error) setServerError(error);
    } finally {
      setSaving(false);
    }
  }, [amount, comment, paidAt, payment, planId, onSubmit]);

  const error = clientError ?? serverError;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Закрытие во время сохранения не отменяет запрос: он уже ушёл, и
        // «отмена» здесь была бы ложью. Диалог просто остаётся открытым.
        if (!next && !saving) onClose();
      }}
    >
      <DialogContent className="sm:max-w-115">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold">
            {payment ? "Оплата" : "Новая оплата"}
          </DialogTitle>
          <DialogDescription className="text-[13px] text-fg-secondary">
            {payment
              ? "Измените сумму, дату, строку графика или комментарий."
              : "Сумма и дата — самостоятельные данные: из стоимости позиции они не выводятся."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Сумма, ₽">
              <Input
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                inputMode="decimal"
                placeholder="0"
                disabled={saving}
                autoFocus
              />
            </Field>

            <Field label="Дата оплаты">
              <Input
                type="date"
                value={paidAt}
                onChange={(event) => setPaidAt(event.target.value)}
                disabled={saving}
              />
            </Field>
          </div>

          <Field label="Строка графика">
            <select
              value={planId}
              onChange={(event) => setPlanId(event.target.value)}
              disabled={saving}
              className="h-9 w-full rounded-lg border border-border-muted bg-bg-white px-2 font-sans text-[13.5px] text-fg"
            >
              <option value="">Без плана — оплата вне графика</option>
              {plans.map((plan) => (
                <option key={plan.id} value={plan.id}>
                  {plan.title} · {fmtRub(plan.amount)}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Комментарий">
            <Textarea
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              placeholder="Номер счёта, основание, примечание"
              rows={3}
              disabled={saving}
            />
          </Field>

          {error && (
            <p role="alert" className="text-[12.5px] text-fg-red">
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            size="lg"
            onClick={onClose}
            disabled={saving}
          >
            Отмена
          </Button>
          <Button
            type="button"
            size="lg"
            onClick={() => void submit()}
            disabled={saving}
          >
            {saving && <Loader2 className="mr-2 size-4 animate-spin" />}
            {payment ? "Сохранить" : "Внести оплату"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
