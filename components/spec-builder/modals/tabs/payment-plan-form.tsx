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
import { PAYMENT_PLAN_LIMITS } from "@/lib/validations";
import type { PaymentPlanEntry } from "@/lib/spec/payment-plan-types";

/**
 * Форма строки графика платежей: создание и правка одной и той же разметкой.
 *
 * ── Почему форма отдельным компонентом ─────────────────────────────────────
 *
 * Поля, их валидация на клиенте и состояние отправки не должны жить в списке:
 * список отвечает за порядок и обновление данных, форма — за ввод. Родитель
 * монтирует её с `key` по открытой строке, поэтому каждое открытие начинает с
 * чистого состояния, а сбрасывать поля эффектом не приходится.
 *
 * ── Что проверяет клиент, а что сервер ─────────────────────────────────────
 *
 * Клиент проверяет только очевидное: название непустое, сумма — положительное
 * число, длины в пределах лимитов. Права, принадлежность позиции и запись в БД —
 * сервер, и его текст отказа показывается как есть: второй, расходящейся
 * валидации здесь нет (то же правило, что у диалога загрузки файла).
 *
 * ── Про срок ───────────────────────────────────────────────────────────────
 *
 * `<input type="date">` отдаёт 'YYYY-MM-DD' или пустую строку. Пустая строка —
 * это «срока нет», и в состояние она уходит как пустое значение, а не как
 * сегодняшняя дата: подставлять дату за пользователя форма не имеет права.
 */

/** Данные строки в том виде, в каком их принимает действие. */
export type PaymentPlanFormValues = {
  title: string;
  amount: number;
  condition: string | null;
  dueDate: string | null;
};

export default function PaymentPlanForm({
  open,
  plan,
  onClose,
  onSubmit,
}: {
  open: boolean;
  /** Редактируемая строка; `null` — создание новой. */
  plan: PaymentPlanEntry | null;
  /** Закрыть без сохранения: отмена, крестик, успех. */
  onClose: () => void;
  /**
   * Сохранить. Возвращает текст ошибки или `null` при успехе: серверный отказ
   * показывается здесь, а закрывает форму родитель — он же обновляет список
   * записанной строкой.
   */
  onSubmit: (values: PaymentPlanFormValues) => Promise<string | null>;
}) {
  const [title, setTitle] = useState(plan?.title ?? "");
  // Сумма в поле — строка: «12 000,5» и «12000.5» должны вводиться одинаково
  // свободно, а разбор — происходить при сохранении.
  const [amount, setAmount] = useState(
    plan ? String(plan.amount) : "",
  );
  const [condition, setCondition] = useState(plan?.condition ?? "");
  const [dueDate, setDueDate] = useState(plan?.dueDate ?? "");

  const [clientError, setClientError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = useCallback(async () => {
    setServerError(null);

    const trimmedTitle = title.trim();
    if (trimmedTitle.length === 0) {
      setClientError("Укажите название платежа");
      return;
    }
    if (trimmedTitle.length > PAYMENT_PLAN_LIMITS.titleMax) {
      setClientError("Название слишком длинное");
      return;
    }

    // Запятая как десятичный разделитель: так сумму вводят в русской раскладке,
    // и отвергать её значило бы заставлять пользователя переучиваться.
    const parsedAmount = Number(amount.trim().replace(",", "."));
    if (amount.trim().length === 0 || !Number.isFinite(parsedAmount)) {
      setClientError("Укажите сумму платежа");
      return;
    }
    if (parsedAmount <= 0) {
      setClientError("Сумма платежа должна быть больше нуля");
      return;
    }
    if (parsedAmount > PAYMENT_PLAN_LIMITS.amountMax) {
      setClientError("Слишком большая сумма");
      return;
    }

    const trimmedCondition = condition.trim();
    if (trimmedCondition.length > PAYMENT_PLAN_LIMITS.conditionMax) {
      setClientError("Условие оплаты слишком длинное");
      return;
    }

    setClientError(null);
    setSaving(true);

    try {
      const error = await onSubmit({
        title: trimmedTitle,
        amount: parsedAmount,
        // Пустое значение — это «не задано», а не пустая строка: в БД у этого
        // состояния одно представление.
        condition: trimmedCondition.length > 0 ? trimmedCondition : null,
        dueDate: dueDate.length > 0 ? dueDate : null,
      });
      if (error) setServerError(error);
    } finally {
      setSaving(false);
    }
  }, [amount, condition, dueDate, onSubmit, title]);

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
            {plan ? "Платёж в графике" : "Новый платёж"}
          </DialogTitle>
          <DialogDescription className="text-[13px] text-fg-secondary">
            {plan
              ? "Измените сумму, условие оплаты или срок."
              : "Плановая сумма — обязательство по позиции. Из её стоимости сумма не выводится."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <Field label="Название">
            <Input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Аванс, поставка, остаток"
              disabled={saving}
              autoFocus
            />
          </Field>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Сумма, ₽">
              <Input
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                inputMode="decimal"
                placeholder="0"
                disabled={saving}
              />
            </Field>

            <Field label="Срок оплаты">
              <Input
                type="date"
                value={dueDate}
                onChange={(event) => setDueDate(event.target.value)}
                disabled={saving}
              />
            </Field>
          </div>

          <Field label="Условие оплаты">
            <Textarea
              value={condition}
              onChange={(event) => setCondition(event.target.value)}
              placeholder="После подписания договора"
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
            {plan ? "Сохранить" : "Добавить"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
