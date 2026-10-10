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
import { todayIso } from "@/lib/spec/payment-date";
import { roundMoney } from "@/lib/spec/payment-schedule";
import type { PaymentPlanEntry } from "@/lib/spec/payment-plan-types";
import {
  PAYMENT_KIND_ACTION_LABEL,
  PAYMENT_KINDS,
  PAYMENT_KIND_LABEL,
  type PaymentEntry,
  type PaymentRecordKind,
} from "@/lib/spec/payment-types";

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
 * Форма создаёт и оплату, и возврат: вид выбирается селектом. Сумма в обоих
 * случаях положительна — направление выражает вид, а не знак (решение O1), и
 * на сервер вид уходит всегда, потому что участвует в ключе идемпотентности
 * («повтор с другим видом — другой платёж»).
 *
 * При ПРАВКЕ селект заблокирован: смена вида — не правка суммы, а другая
 * проводка, и сервер такой запрос отвергает. Правильный путь — отменить
 * ошибочную запись и внести верную; форма не подменяет это правило догадкой.
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

/**
 * Готовые доли стоимости: самые частые случаи ввода (аванс, половина,
 * полностью). Своё число вводится в поле процента рядом.
 */
const PERCENT_PRESETS = [25, 50, 100] as const;

export default function PaymentForm({
  open,
  payment,
  plans,
  itemCost = 0,
  remaining = 0,
  onClose,
  onSubmit,
}: {
  open: boolean;
  /** Редактируемая запись; `null` — создание новой. */
  payment: PaymentEntry | null;
  /** График позиции: варианты привязки. Пустой список — плана ещё нет. */
  plans: PaymentPlanEntry[];
  /**
   * Стоимость позиции — база для процента. Ноль означает, что процент
   * предлагать не от чего: делить не на что.
   */
  itemCost?: number;
  /**
   * Сколько осталось доплатить по позиции (`стоимость − оплачено`).
   *
   * Справка о позиции, а не поле записи: показывается, чтобы вводящий видел
   * контекст, и подставляется в сумму одним нажатием — обычный случай «это
   * последний платёж». Ноль означает «доплачивать нечего», и тогда справки нет.
   */
  remaining?: number;
  /** Закрыть без сохранения: отмена, крестик, успех. */
  onClose: () => void;
  /**
   * Сохранить. Возвращает текст ошибки или `null` при успехе: серверный отказ
   * показывается здесь, а закрывает форму родитель — он же обновляет список
   * записанной строкой.
   */
  onSubmit: (values: PaymentFormValues) => Promise<string | null>;
}) {
  /**
   * Вид записи: у новой — оплата, у правки — вид самой записи.
   *
   * Своё состояние, а не только `payment?.kind`, потому что при СОЗДАНИИ вид
   * выбирает пользователь. При правке значение то же, но селект заблокирован —
   * смена вида здесь запрещена (см. заголовок модуля).
   */
  const [kind, setKind] = useState<PaymentRecordKind>(payment?.kind ?? "payment");
  /** Сумма — строкой: «12 000,5» и «12000.5» должны вводиться одинаково свободно. */
  const [amount, setAmount] = useState(payment ? String(payment.amount) : "");
  // Дата по умолчанию — сегодня. Считает её общий модуль
  // (`lib/spec/payment-date`), тот же, которым пользуется ядро: иначе форма и
  // запись в БД расходились бы на границе суток и в разных часовых поясах.
  const [paidAt, setPaidAt] = useState(payment?.paidAt ?? todayIso());
  /** Пустая строка — «без плана»: у селекта это значение, а не отсутствие выбора. */
  const [planId, setPlanId] = useState(payment?.paymentPlanId ?? "");
  const [comment, setComment] = useState(payment?.comment ?? "");

  const [clientError, setClientError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  /**
   * Процент от стоимости — только способ ввода суммы.
   *
   * Хранится в состоянии формы и НЕ уходит на сервер: в БД ложится посчитанная
   * сумма (решение интервью 2026-10-10). Двух правд — суммы и процента — не
   * заводится, потому что при смене стоимости они разошлись бы, и никто не
   * сказал бы, какая верна.
   */
  const [percent, setPercent] = useState("");

  /**
   * Процент предлагается, только когда есть от чего считать: стоимость ноль —
   * деление на ноль, и показывать поле было бы обещанием, которого нет.
   */
  const percentAvailable = !payment && itemCost > 0;

  /** Доплачивать есть что — иначе справка сообщала бы «осталось 0 ₽». */
  const hasRemaining = remaining > 0;

  /** Заполнить сумму из процента, округляя до копейки. */
  const applyPercent = useCallback(
    (value: string) => {
      setPercent(value);
      const parsed = Number(value.trim().replace(",", "."));
      if (value.trim().length === 0 || !Number.isFinite(parsed)) return;
      setAmount(String(roundMoney((itemCost * parsed) / 100)));
    },
    [itemCost],
  );

  const submit = useCallback(async () => {
    setServerError(null);

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
  }, [amount, comment, kind, paidAt, planId, onSubmit]);
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
            {payment
              ? PAYMENT_KIND_LABEL[kind]
              : `Новая запись · ${PAYMENT_KIND_LABEL[kind].toLowerCase()}`}
          </DialogTitle>
          <DialogDescription className="text-[13px] text-fg-secondary">
            {payment
              ? "Измените сумму, дату, строку графика или комментарий."
              : "Сумма и дата — самостоятельные данные: из стоимости позиции они не выводятся."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          {/*
            Вид записи убран в «Дополнительно»: в подавляющем большинстве случаев
            вносят оплату, и поле не должно стоять первым. Возврат никуда не
            делся — он открывается здесь же, и подпись кнопки отправки за видом
            следит даже при закрытом блоке, поэтому выбор виден и без раскрытия.

            При правке блок остаётся, но селект внутри заблокирован: смена вида —
            другая проводка, а не правка (см. заголовок модуля). Показывать
            заблокированное поле полезно: видно, что это возврат, а не оплата.
          */}
          <details className="rounded-lg border border-border-muted px-3 py-2">
            <summary className="cursor-pointer text-[12.5px] text-fg-muted select-none">
              Дополнительно
            </summary>
            <div className="mt-2.5">
              <Field label="Вид записи">
                {/*
                  Селект, а не переключатель: вариантов ровно два, и нативный
                  `select` уже используется соседним полем «Строка графика».

                  `aria-label` совпадает с видимой подписью: `Field` рисует
                  `<label>` без `htmlFor`, поэтому без этого доступного имени у
                  селекта его не было бы вовсе — и диктор, и тест искали бы поле
                  безымянным.
                */}
                <select
                  aria-label="Вид записи"
                  value={kind}
                  onChange={(event) =>
                    setKind(event.target.value as PaymentRecordKind)
                  }
                  // Вид существующей записи не меняется: это другая проводка, а не
                  // правка (см. заголовок модуля).
                  disabled={saving || payment !== null}
                  className="h-9 w-full rounded-lg border border-border-muted bg-bg-white px-2 font-sans text-[13.5px] text-fg disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {PAYMENT_KINDS.map((value) => (
                    <option key={value} value={value}>
                      {PAYMENT_KIND_LABEL[value]}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          </details>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Сумма, ₽">
              {/*
                `aria-label` повторяет видимую подпись, как у селекта вида
                записи: `Field` рисует `<label>` без `htmlFor`, поэтому иначе у
                поля не было бы доступного имени. Оно же отличает сумму от поля
                процента — у обоих плейсхолдер «0».
              */}
              <Input
                aria-label="Сумма, ₽"
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

          {/*
            Процент — способ ВВОДА суммы, а не данные записи: он заполняет поле
            выше, и в БД уходит посчитанная сумма. Поэтому поле процента стоит
            рядом с суммой, а не отдельной сущностью.
          */}
          {percentAvailable && (
            <Field label={`Процент от стоимости (${fmtRub(itemCost)})`}>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  aria-label="Процент от стоимости"
                  value={percent}
                  onChange={(event) => applyPercent(event.target.value)}
                  inputMode="decimal"
                  placeholder="0"
                  disabled={saving}
                  className="w-20 h-9"
                />
                {PERCENT_PRESETS.map((preset) => (
                  <Button
                    key={preset}
                    type="button"
                    variant="outline"
                    size="lg"
                    disabled={saving}
                    onClick={() => applyPercent(String(preset))}
                  >
                    {preset} %
                  </Button>
                ))}
              </div>
            </Field>
          )}

          {/*
            Сколько осталось доплатить по позиции — справка о позиции, а не поле
            записи. Кнопка подставляет остаток в сумму: обычный случай «это
            последний платёж». В правке кнопки нет — она подменила бы уже
            существующую сумму целиком.
          */}
          {hasRemaining && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg bg-bg-card2 px-3 py-2">
              <span className="text-[12.5px] text-fg-muted">
                Не оплачено:{" "}
                <span className="font-mono tabular-nums text-fg">
                  {fmtRub(remaining)}
                </span>
              </span>
              {payment === null && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={saving}
                  onClick={() => {
                    setPercent("");
                    setAmount(String(remaining));
                  }}
                >
                  Подставить остаток
                </Button>
              )}
            </div>
          )}

          {/*
            Поле остаётся в разметке и сохраняет своё значение, но НЕ
            показывается: график платежей выведен из интерфейса целиком, поэтому
            у привязки к его строке нет видимого контекста.

            Убрать поле нельзя: правка записи отправляет `paymentPlanId`
            (`updatePayment` пишет `payment_plan_id`), поэтому удаление поля
            молча стёрло бы привязку у всех существующих оплат. Скрытое поле
            сохраняет её, а новый платёж получает «без плана», как и раньше.
          */}
          <div hidden>
            <Field label="Строка графика">
              <select
                aria-label="Строка графика"
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
          </div>

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
            {payment ? "Сохранить" : PAYMENT_KIND_ACTION_LABEL[kind]}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
