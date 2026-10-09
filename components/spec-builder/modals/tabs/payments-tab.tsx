"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  CalendarPlus,
  Loader2,
  Pencil,
  Plus,
  Receipt,
  Trash2,
  Wallet,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { cn, fmtRub } from "@/lib/utils";
import {
  createPaymentPlan,
  deletePaymentPlan,
  listPaymentPlans,
  movePaymentPlan,
  updatePaymentPlan,
} from "@/actions/spec-item-payment-plans";
import {
  createPayment,
  deletePayment,
  listPayments,
  updatePayment,
} from "@/actions/spec-item-payments";
import { paymentPlanDeadline } from "@/lib/spec/service-operation-deadline";
import {
  paymentPlanCoverage,
  summarisePaymentSchedule,
} from "@/lib/spec/payment-schedule";
import { canMutatePayment, canRecordPayment, isForeignPayment } from "@/lib/spec/payment-permissions";
import { PAYMENT_KIND_LABEL } from "@/lib/spec/payment-types";
import type { PaymentEntry } from "@/lib/spec/payment-types";
import type { PaymentPlanEntry } from "@/lib/spec/payment-plan-types";
import type { OrgRole } from "@/lib/permissions";
import PaymentPlanForm, {
  type PaymentPlanFormValues,
} from "./payment-plan-form";
import PaymentForm, { type PaymentFormValues } from "./payment-form";

/**
 * Вкладка «Платежи» карточки материала: график и фактические оплаты позиции.
 *
 * ── Что здесь есть ─────────────────────────────────────────────────────────
 *
 * 1. сводка: план · оплачено · остаток · переплата · вне графика (возвраты —
 *    своей строкой, когда они появятся: тикет 03);
 * 2. график: строки с покрытием (`оплачено / осталось`), сроком и действиями;
 * 3. факты: дата, сумма, привязка к строке графика, комментарий, автор и
 *    действия по правам;
 * 4. две формы — строка графика и оплата.
 *
 * ── Почему данные грузятся вкладкой, а не приходят пропсом ─────────────────
 *
 * Тем же приёмом, что «Файлы» и «Комментарии»: у вкладки собственный запрос в
 * локальное состояние. Конструктор держит `items` в `useState`, синхронизации с
 * пропсами нет, и `revalidatePath` из action до открытой модалки не доходит —
 * полагаться на него здесь нельзя. Поэтому оба списка обновляются из ответов
 * действий (они возвращают записанную строку), а после перестановки графика
 * список перечитывается: там меняется не одна строка.
 *
 * ── Почему один запрос на две таблицы ──────────────────────────────────────
 *
 * График и факты читаются ВМЕСТЕ (`Promise.all`) и обновляются вместе. Причина не
 * в экономии запросов: покрытие строки — это факты по строке, и список фактов,
 * показанный рядом со старым графиком, давал бы неверные остатки. Одновременная
 * загрузка делает состояние вкладки одним куском, а не двумя, которые могут
 * разъехаться.
 *
 * ── Арифметика ─────────────────────────────────────────────────────────────
 *
 * Все суммы считает чистый модуль `lib/spec/payment-schedule`: сумма графика,
 * оплачено, возвраты, остаток, переплата, оплаты вне графика и покрытие строк.
 * Второй формулы в разметке нет — иначе остаток в сводке и в строке графика мог
 * бы разойтись.
 *
 * ── Порядок ────────────────────────────────────────────────────────────────
 *
 * Ни один список не сортируется на клиенте: сервер отдаёт строки графика по
 * `position`, `id`, а факты — по дате оплаты и времени записи. Клиентская
 * сортировка была бы вторым, расходящимся правилом порядка.
 *
 * ── Права ──────────────────────────────────────────────────────────────────
 *
 * Кнопки действий скрываются по `lib/spec/payment-permissions`: наблюдатель не
 * вносит и не правит, участник правит только свои записи, чужие — владелец и
 * администратор. Это UI-гейт, а не защита: сервер проверяет то же самое ещё раз.
 */

/** Сколько строк-заготовок показывать при загрузке. */
const SKELETON_ROWS = 3;

/**
 * Ключ идемпотентности новой оплаты.
 *
 * Генерируется на КАЖДОЕ открытие формы и живёт, пока она открыта: поэтому
 * двойное нажатие и ретрай отправляют один ключ, а новая оплата после закрытия
 * получает новый. `crypto.randomUUID` есть во всех целевых браузерах, но
 * небезопасный контекст (http на не-localhost) его не даёт — тогда ключ
 * собирается из случайных байт: для ключа идемпотентности этого достаточно и
 * этого не хватило бы для секрета.
 */
function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  const bytes =
    typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function"
      ? crypto.getRandomValues(new Uint8Array(16))
      : Uint8Array.from({ length: 16 }, () => Math.floor(Math.random() * 256));

  // Версия 4 и вариант RFC 4122 — чтобы значение было настоящим uuid.
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
  return [
    hex.slice(0, 4).join(""),
    hex.slice(4, 6).join(""),
    hex.slice(6, 8).join(""),
    hex.slice(8, 10).join(""),
    hex.slice(10, 16).join(""),
  ].join("-");
}

/** Строка-заготовка: та же геометрия, что у настоящей строки списка. */
function RowSkeleton() {
  return (
    <div className="flex w-full items-center gap-2.5 rounded-xl px-2 py-2">
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <Skeleton className="h-3.5 w-1/3" />
        <Skeleton className="h-3 w-2/3" />
      </div>
      <Skeleton className="h-3.5 w-20 shrink-0" />
      <Skeleton className="size-6 shrink-0 rounded-md" />
    </div>
  );
}

/** Дата срока: 'YYYY-MM-DD' → «1 ноября 2026 г.». */
function dateLabel(value: string): string {
  return new Date(`${value}T00:00:00`).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/** Строка сводки: подпись и значение. */
function SummaryCell({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "muted" | "accent" | "danger";
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="font-mono text-[10.5px] uppercase tracking-wider text-fg-muted">
        {label}
      </span>
      <span
        className={cn(
          "font-mono text-[13.5px] tabular-nums",
          tone === "muted" && "text-fg-dim",
          tone === "accent" && "text-fg-brand",
          tone === "danger" && "text-fg-red",
          tone === "default" && "text-fg",
        )}
      >
        {value}
      </span>
    </div>
  );
}

export default function PaymentsTab({
  orgSlug,
  specItemId,
  /** Роль в организации: гейт для кнопок записи. Проверку повторяет сервер. */
  role,
  /** Текущий пользователь: по авторству решается, какие кнопки показывать. */
  currentUserId,
  /** Стоимость позиции — справка. Остаток от неё не считается (решение Q1). */
  itemCost,
}: {
  /** Слаг организации: организация берётся на сервере из сессии, не с клиента. */
  orgSlug: string;
  /** Позиция, чей график и факты ведём. */
  specItemId: string;
  role: OrgRole | null;
  currentUserId: string;
  itemCost?: number;
}) {
  const [plans, setPlans] = useState<PaymentPlanEntry[]>([]);
  const [payments, setPayments] = useState<PaymentEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  /** Для какой позиции пришли данные. Не совпало с текущей — идёт загрузка. */
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  /** Идёт ли запрос прямо сейчас: нужен кнопке «Повторить». */
  const [inFlight, setInFlight] = useState(false);

  /** Форма строки графика: `null` — закрыта; `{ plan: null }` — создание. */
  const [planForm, setPlanForm] = useState<{
    plan: PaymentPlanEntry | null;
  } | null>(null);
  /** Форма оплаты: `null` — закрыта; `{ payment: null }` — создание. */
  const [paymentForm, setPaymentForm] = useState<{
    payment: PaymentEntry | null;
    idempotencyKey: string;
  } | null>(null);
  /**
   * Номер открытия формы графика: входит в её `key`.
   *
   * Без него повторное «Добавить платёж» после закрытия формы получило бы тот же
   * key, что у прошлого открытия, — и React не пересоздал бы компонент, оставив
   * в полях значения прошлой строки.
   */
  const [formVersion, setFormVersion] = useState(0);
  /** Строка графика, для которой открыто подтверждение удаления. */
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  /** Запись, для которой открыто подтверждение отмены. */
  const [pendingCancelId, setPendingCancelId] = useState<string | null>(null);
  /** Идёт операция: кнопки этой строки выключены. */
  const [busy, setBusy] = useState<{
    itemKey: string;
    rowId: string;
    kind: "move" | "delete" | "cancel";
  } | null>(null);
  /** Ошибка действия — у своей строки, чтобы списки продолжали работать. */
  const [actionError, setActionError] = useState<{
    itemKey: string;
    rowId: string | null;
    message: string;
  } | null>(null);

  /** Номер попытки загрузки: гасит устаревшие ответы. */
  const requestIdRef = useRef(0);
  /**
   * Актуальная позиция для асинхронных ответов: колбэк, созданный в прошлой
   * отрисовке, держит в замыкании прежний `specItemId`.
   */
  const specItemIdRef = useRef(specItemId);
  useEffect(() => {
    specItemIdRef.current = specItemId;
  }, [specItemId]);

  const canWrite = canRecordPayment({ role });

  /**
   * Загрузка обоих списков: ничего не пишет в состояние сама, а возвращает
   * результат — поэтому её одинаково используют эффект и «Повторить».
   */
  const requestLists = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    const forItem = specItemId;

    try {
      const [plansRes, paymentsRes] = await Promise.all([
        listPaymentPlans(orgSlug, forItem),
        listPayments(orgSlug, forItem),
      ]);

      if (requestId !== requestIdRef.current) return null;
      if (!plansRes.success) return { ok: false as const, message: plansRes.error };
      if (!paymentsRes.success) {
        return { ok: false as const, message: paymentsRes.error };
      }

      return {
        ok: true as const,
        plans: plansRes.data,
        payments: paymentsRes.data,
      };
    } catch (cause) {
      // Server action может отклониться, не дойдя до `ActionResult` (сеть):
      // для UI это то же самое «не удалось».
      if (requestId !== requestIdRef.current) return null;
      console.error("[PaymentsTab] данные платежей", cause);
      return { ok: false as const, message: "Не удалось загрузить платежи" };
    }
  }, [orgSlug, specItemId]);

  const applyLists = useCallback(
    (result: Awaited<ReturnType<typeof requestLists>>) => {
      // `null` — устаревший ответ: он не должен перезаписать актуальные списки.
      if (result === null) return;

      if (result.ok) {
        setPlans(result.plans);
        setPayments(result.payments);
        setLoadedKey(specItemId);
        setError(null);
      } else {
        setError(result.message);
      }
    },
    [specItemId],
  );

  const retry = useCallback(() => {
    setError(null);
    setInFlight(true);
    void requestLists()
      .then(applyLists)
      .finally(() => setInFlight(false));
  }, [requestLists, applyLists]);

  useEffect(() => {
    void requestLists().then(applyLists);
    // Смена позиции и размонтирование отменяют ответы прошлых запросов: номер
    // попытки растёт, и поздний ответ уже не актуален.
    return () => {
      requestIdRef.current += 1;
    };
  }, [requestLists, applyLists]);

  const isCurrent = loadedKey === specItemId;
  const loading = !isCurrent && (error === null || inFlight);
  const failed = !isCurrent && error !== null && !inFlight;

  const busyHere = busy?.itemKey === specItemId ? busy : null;
  const actionErrorHere =
    actionError?.itemKey === specItemId ? actionError : null;

  const pendingCancelPayment =
    payments.find((payment) => payment.id === pendingCancelId) ?? null;
  const pendingDeletePlan =
    plans.find((plan) => plan.id === pendingDeleteId) ?? null;

  /**
   * Сводка и покрытие строк. Считаются из ТЕХ ЖЕ данных, что видит пользователь,
   * — по чистому модулю `payment-schedule`, а не по второй формуле в разметке.
   */
  const summary = summarisePaymentSchedule(
    plans.map((plan) => ({
      id: plan.id,
      amount: plan.amount,
      position: plan.position,
      deletedAt: null,
    })),
    payments.map((payment) => ({
      paymentPlanId: payment.paymentPlanId,
      amount: payment.amount,
      kind: payment.kind,
      deletedAt: null,
    })),
  );

  const coverage = useMemo(
    () =>
      paymentPlanCoverage(
        plans.map((plan) => ({
          id: plan.id,
          amount: plan.amount,
          position: plan.position,
          deletedAt: null,
        })),
        payments.map((payment) => ({
          paymentPlanId: payment.paymentPlanId,
          amount: payment.amount,
          kind: payment.kind,
          deletedAt: null,
        })),
      ),
    [plans, payments],
  );

  /** Названия строк графика: по ним список фактов называет привязку. */
  const planTitles = useMemo(() => {
    const map = new Map<string, string>();
    for (const plan of plans) map.set(plan.id, plan.title);
    return map;
  }, [plans]);

  /** Сохранение строки графика: создание или правка — по тому, что открыто. */
  const submitPlan = useCallback(
    async (values: PaymentPlanFormValues) => {
      const editing = planForm?.plan ?? null;
      const forItem = specItemId;

      try {
        const res = editing
          ? await updatePaymentPlan(orgSlug, forItem, editing.id, values)
          : await createPaymentPlan(orgSlug, forItem, values);

        if (specItemIdRef.current !== forItem) return null;
        if (!res.success) return res.error;

        // В список встаёт ЗАПИСЬ СЕРВЕРА, а не локальная догадка: порядок и
        // нормализованный текст — те же, что лежат в БД.
        setPlans((current) =>
          editing
            ? current.map((plan) => (plan.id === res.data.id ? res.data : plan))
            : [...current, res.data],
        );
        setPlanForm(null);
        setActionError(null);
        return null;
      } catch (cause) {
        if (specItemIdRef.current !== forItem) return null;
        console.error("[PaymentsTab] сохранение платежа", cause);
        return "Не удалось сохранить платёж";
      }
    },
    [planForm, orgSlug, specItemId],
  );

  /** Сохранение оплаты: тем же приёмом, что строка графика. */
  const submitPayment = useCallback(
    async (values: PaymentFormValues) => {
      const editing = paymentForm?.payment ?? null;
      const key = paymentForm?.idempotencyKey ?? newIdempotencyKey();
      const forItem = specItemId;

      try {
        const res = editing
          ? await updatePayment(orgSlug, forItem, editing.id, values)
          : await createPayment(orgSlug, forItem, {
              ...values,
              idempotencyKey: key,
            });

        if (specItemIdRef.current !== forItem) return null;
        if (!res.success) return res.error;

        // Повтор запроса с тем же ключом возвращает уже созданную запись:
        // вставка по id не даёт дубля, а список остаётся одним и тем же.
        setPayments((current) => {
          const exists = current.some((payment) => payment.id === res.data.id);
          return exists
            ? current.map((payment) =>
                payment.id === res.data.id ? res.data : payment,
              )
            : [res.data, ...current];
        });
        setPaymentForm(null);
        setActionError(null);
        return null;
      } catch (cause) {
        if (specItemIdRef.current !== forItem) return null;
        console.error("[PaymentsTab] сохранение оплаты", cause);
        return "Не удалось сохранить оплату";
      }
    },
    [paymentForm, orgSlug, specItemId],
  );

  /**
   * Перестановка строки графика на одну позицию.
   *
   * После успеха список ПЕРЕЧИТЫВАЕТСЯ: перестановка меняет номер не у одной
   * строки, и собирать новый порядок на клиенте значило бы завести вторую
   * формулу порядка рядом с серверной.
   */
  const move = useCallback(
    async (planId: string, direction: "up" | "down") => {
      const forItem = specItemId;
      setBusy({ itemKey: forItem, rowId: planId, kind: "move" });
      setActionError(null);

      try {
        const res = await movePaymentPlan(orgSlug, forItem, planId, direction);
        if (specItemIdRef.current !== forItem) return;

        if (!res.success) {
          setActionError({ itemKey: forItem, rowId: planId, message: res.error });
          return;
        }

        // Переставлять некуда — не ошибка: список остаётся как есть.
        if (!res.data.moved) return;

        const lists = await requestLists();
        if (specItemIdRef.current !== forItem) return;
        applyLists(lists);
      } catch (cause) {
        if (specItemIdRef.current !== forItem) return;
        console.error("[PaymentsTab] перестановка платежа", cause);
        setActionError({
          itemKey: forItem,
          rowId: planId,
          message: "Не удалось переставить платёж",
        });
      } finally {
        if (specItemIdRef.current === forItem) setBusy(null);
      }
    },
    [applyLists, orgSlug, requestLists, specItemId],
  );

  /** Удаление строки графика: строка исчезает только после успешного ответа. */
  const removePlan = useCallback(async () => {
    const planId = pendingDeleteId;
    if (!planId) return;
    if (busy?.rowId === planId && busy.kind === "delete") return;

    const forItem = specItemId;
    setBusy({ itemKey: forItem, rowId: planId, kind: "delete" });
    setActionError(null);

    try {
      const res = await deletePaymentPlan(orgSlug, forItem, planId);
      if (specItemIdRef.current !== forItem) return;

      if (!res.success) {
        // Диалог закрываем: иначе он висел бы поверх списка, а сообщение об
        // ошибке и сама строка были бы под ним.
        setPendingDeleteId(null);
        setActionError({ itemKey: forItem, rowId: planId, message: res.error });
        return;
      }

      setPlans((current) => current.filter((plan) => plan.id !== planId));
      setPendingDeleteId(null);
    } catch (cause) {
      if (specItemIdRef.current !== forItem) return;
      console.error("[PaymentsTab] удаление платежа", cause);
      setPendingDeleteId(null);
      setActionError({
        itemKey: forItem,
        rowId: planId,
        message: "Не удалось удалить платёж",
      });
    } finally {
      if (specItemIdRef.current === forItem) setBusy(null);
    }
  }, [busy, orgSlug, pendingDeleteId, specItemId]);

  /** Отмена оплаты: запись исчезает из списка только после успеха. */
  const cancelPayment = useCallback(async () => {
    const paymentId = pendingCancelId;
    if (!paymentId) return;
    if (busy?.rowId === paymentId && busy.kind === "cancel") return;

    const forItem = specItemId;
    setBusy({ itemKey: forItem, rowId: paymentId, kind: "cancel" });
    setActionError(null);

    try {
      const res = await deletePayment(orgSlug, forItem, paymentId);
      if (specItemIdRef.current !== forItem) return;

      if (!res.success) {
        setPendingCancelId(null);
        setActionError({ itemKey: forItem, rowId: paymentId, message: res.error });
        return;
      }

      setPayments((current) =>
        current.filter((payment) => payment.id !== paymentId),
      );
      setPendingCancelId(null);
    } catch (cause) {
      if (specItemIdRef.current !== forItem) return;
      console.error("[PaymentsTab] отмена оплаты", cause);
      setPendingCancelId(null);
      setActionError({
        itemKey: forItem,
        rowId: paymentId,
        message: "Не удалось отменить оплату",
      });
    } finally {
      if (specItemIdRef.current === forItem) setBusy(null);
    }
  }, [busy, orgSlug, pendingCancelId, specItemId]);

  return (
    <div className="flex flex-col gap-2 py-4">
      {loading &&
        Array.from({ length: SKELETON_ROWS }, (_, index) => (
          <div key={index} aria-hidden="true">
            <RowSkeleton />
          </div>
        ))}

      {failed && (
        <div
          role="alert"
          className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border-muted px-4 py-8 text-center"
        >
          <p className="text-[13px] text-fg-muted">{error}</p>
          <Button type="button" variant="outline" size="sm" onClick={retry}>
            Повторить
          </Button>
        </div>
      )}

      {isCurrent && (
        <>
          {/*
            Сводка. «Переплата» и «Вне графика» — раздельные величины: при пустом
            графике оплата вне графика не превращается в переплату на 100 %
            (REPORT §5.1). «Возвраты» появляются строкой только тогда, когда они
            есть: нулевая строка «Возвраты» ничего не сообщает.
          */}
          <div className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl border border-border-muted bg-bg-card2 px-3.5 py-3 sm:grid-cols-4">
            <SummaryCell label="План" value={fmtRub(summary.planned)} />
            <SummaryCell
              label="Оплачено"
              value={fmtRub(summary.paid)}
              tone="muted"
            />
            <SummaryCell label="Остаток" value={fmtRub(summary.remaining)} />
            <SummaryCell
              label="Переплата"
              value={fmtRub(summary.overpaid)}
              tone={summary.overpaid > 0 ? "danger" : "muted"}
            />
            <SummaryCell
              label="Вне графика"
              value={fmtRub(summary.unplanned)}
              tone={summary.unplanned !== 0 ? "accent" : "muted"}
            />
            {summary.refunded !== 0 && (
              <SummaryCell
                label="Возвраты"
                value={fmtRub(summary.refunded)}
                tone="danger"
              />
            )}
          </div>

          {/*
            Стоимость позиции — справка рядом с платежами, а не база остатка
            (решение Q1). Подпись называет источник: цена и количество позиции
            считаются отдельно и ни на график, ни на факты не влияют.
          */}
          {itemCost !== undefined && (
            <p className="px-1 text-[11.5px] text-fg-dim">
              Стоимость позиции:{" "}
              <span className="font-mono">{fmtRub(itemCost)}</span> — справка,
              остаток от неё не считается
            </p>
          )}

          {actionErrorHere && actionErrorHere.rowId === null && (
            <p role="alert" className="px-1 text-[12px] text-fg-red">
              {actionErrorHere.message}
            </p>
          )}

          {/* ── Факты: что реально заплачено ───────────────────────────── */}
          <div className="flex items-center justify-between gap-2 px-1">
            <span className="flex items-center gap-1.5 text-[11.5px] text-fg-muted">
              <Wallet className="size-3.5" aria-hidden="true" />
              {payments.length > 0
                ? `Оплат и возвратов: ${payments.length}`
                : "Оплат пока нет"}
            </span>
            {canWrite && (
              <Button
                type="button"
                variant="outline"
                className="shrink-0 gap-1.5"
                onClick={() => {
                  setFormVersion((current) => current + 1);
                  setPaymentForm({
                    payment: null,
                    // Ключ живёт от открытия формы до её закрытия: повторное
                    // нажатие «Внести» отправляет тот же ключ.
                    idempotencyKey: newIdempotencyKey(),
                  });
                }}
              >
                <Plus className="size-3.5" />
                Внести оплату
              </Button>
            )}
          </div>

          {payments.length === 0 && (
            <div className="flex flex-col items-center gap-1.5 rounded-xl border-2 border-dashed border-border-muted px-4 py-6 text-center">
              <Receipt className="size-5 text-fg-dim" aria-hidden="true" />
              <p className="text-[13.5px] font-medium text-fg">
                Фактических оплат нет
              </p>
              <p className="max-w-xs text-[12.5px] text-fg-muted">
                Оплата без строки графика тоже допустима: тогда она считается
                вне графика.
              </p>
            </div>
          )}

          {payments.map((payment) => {
            const rowBusy = busyHere?.rowId === payment.id ? busyHere : null;
            const rowError =
              actionErrorHere?.rowId === payment.id ? actionErrorHere.message : null;
            const editable = canMutatePayment({
              role,
              userId: currentUserId,
              createdBy: payment.authorId,
            });
            const planTitle = payment.paymentPlanId
              ? planTitles.get(payment.paymentPlanId)
              : null;

            return (
              <div
                key={payment.id}
                className="flex flex-col gap-1 rounded-xl border border-border-muted px-3 py-2.5"
              >
                <div className="flex items-start gap-3">
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <div className="flex min-w-0 items-baseline gap-2">
                      <span className="truncate font-mono text-[13px] text-fg-muted">
                        {dateLabel(payment.paidAt)}
                      </span>
                      <span
                        className={cn(
                          "shrink-0 font-mono text-[13.5px] tabular-nums",
                          payment.kind === "refund" ? "text-fg-red" : "text-fg",
                        )}
                      >
                        {payment.kind === "refund" ? "−" : ""}
                        {fmtRub(payment.amount)}
                      </span>
                      <span className="shrink-0 text-[11.5px] text-fg-dim">
                        {PAYMENT_KIND_LABEL[payment.kind]}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-fg-muted">
                      {/* Привязка: название строки графика, «без плана» или
                          честная пометка, что строки больше нет в графике. */}
                      {payment.paymentPlanId === null ? (
                        <span className="text-fg-dim">Без плана · вне графика</span>
                      ) : (
                        <span className="min-w-0 truncate">
                          {planTitle ?? "Строка графика удалена"}
                        </span>
                      )}
                      {payment.comment && (
                        <span className="min-w-0">{payment.comment}</span>
                      )}
                    </div>

                    <span className="text-[11.5px] text-fg-dim">
                      {payment.authorName ?? "Автор неизвестен"}
                    </span>

                    {rowError && (
                      <span role="alert" className="text-[12px] text-fg-red">
                        {rowError}
                      </span>
                    )}
                  </div>

                  {editable && (
                    <div className="flex shrink-0 items-center gap-0.5">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`Изменить оплату от ${dateLabel(payment.paidAt)}`}
                        title="Изменить"
                        disabled={rowBusy !== null}
                        onClick={() => {
                          setFormVersion((current) => current + 1);
                          setPaymentForm({
                            payment,
                            // Ключ правке не нужен: она не создаёт запись. Но
                            // поле обязано быть — форма одна на оба случая.
                            idempotencyKey: newIdempotencyKey(),
                          });
                        }}
                      >
                        <Pencil className="size-3.5" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`Отменить оплату от ${dateLabel(payment.paidAt)}`}
                        title="Отменить"
                        className="hover:bg-bg-red-light hover:text-fg-red"
                        disabled={rowBusy !== null}
                        onClick={() => setPendingCancelId(payment.id)}
                      >
                        {rowBusy?.kind === "cancel" ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="size-3.5" />
                        )}
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {/* ── График: обязательства ─────────────────────────────────── */}
          <div className="mt-2 flex items-center justify-between gap-2 px-1">
            <span className="flex items-center gap-1.5 text-[11.5px] text-fg-muted">
              <CalendarPlus className="size-3.5" aria-hidden="true" />
              {plans.length > 0
                ? `Строк в графике: ${plans.length}`
                : "График платежей пуст"}
            </span>
            {canWrite && (
              <Button
                type="button"
                variant="outline"
                className="shrink-0 gap-1.5"
                onClick={() => {
                  setFormVersion((current) => current + 1);
                  setPlanForm({ plan: null });
                }}
              >
                <Plus className="size-3.5" />
                Добавить платёж
              </Button>
            )}
          </div>

          {plans.length === 0 && (
            <div className="flex flex-col items-center gap-1.5 rounded-xl border-2 border-dashed border-border-muted px-4 py-6 text-center">
              <CalendarPlus className="size-5 text-fg-dim" aria-hidden="true" />
              <p className="text-[13.5px] font-medium text-fg">
                Платежей пока нет
              </p>
              <p className="max-w-xs text-[12.5px] text-fg-muted">
                График — это обязательства по позиции: сумма, условие оплаты и
                срок. Из стоимости позиции он не выводится.
              </p>
            </div>
          )}

          {plans.map((plan, index) => {
            const deadline = paymentPlanDeadline({ dueDate: plan.dueDate });
            const rowBusy = busyHere?.rowId === plan.id ? busyHere : null;
            const rowError =
              actionErrorHere?.rowId === plan.id ? actionErrorHere.message : null;
            const planCoverage = coverage.get(plan.id);
            const coverPaid = planCoverage?.paid ?? 0;
            const coverRemaining = planCoverage?.remaining ?? plan.amount;
            const coverOverpaid = planCoverage?.overpaid ?? 0;

            return (
              <div
                key={plan.id}
                className="flex flex-col gap-1 rounded-xl border border-border-muted px-3 py-2.5"
              >
                <div className="flex items-start gap-3">
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <div className="flex min-w-0 items-baseline gap-2">
                      <span className="truncate text-[13.5px] font-medium text-fg">
                        {plan.title}
                      </span>
                      <span className="shrink-0 font-mono text-[13.5px] tabular-nums text-fg">
                        {fmtRub(plan.amount)}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-fg-muted">
                      {plan.condition ? (
                        <span className="min-w-0">{plan.condition}</span>
                      ) : (
                        <span className="text-fg-dim">Условие не указано</span>
                      )}
                      {plan.dueDate && (
                        <span
                          className={cn(
                            "font-mono",
                            deadline?.overdue ? "text-fg-red" : "text-fg-muted",
                          )}
                          // Тот же приём, что у строки услуги: срок показывает
                          // «сегодня / через N дн. / просрочено N дн.».
                          title={deadline?.text}
                        >
                          до {dateLabel(plan.dueDate)}
                          {deadline ? ` · ${deadline.text}` : ""}
                        </span>
                      )}
                    </div>

                    {/*
                      Покрытие строки: сколько по ней уже оплачено и сколько
                      осталось. Частичные оплаты видны именно здесь — сумма
                      фактов по строке против её суммы.
                    */}
                    <span className="text-[11.5px] text-fg-dim">
                      {coverPaid === 0 && coverOverpaid === 0 ? (
                        "Не оплачено"
                      ) : (
                        <>
                          Оплачено{" "}
                          <span className="font-mono">{fmtRub(coverPaid)}</span>
                          {coverOverpaid > 0 ? (
                            <>
                              {" · "}
                              <span className="text-fg-red">
                                переплата {fmtRub(coverOverpaid)}
                              </span>
                            </>
                          ) : (
                            <>
                              {" · "}
                              осталось{" "}
                              <span className="font-mono">
                                {fmtRub(coverRemaining)}
                              </span>
                            </>
                          )}
                        </>
                      )}
                    </span>

                    {rowError && (
                      <span role="alert" className="text-[12px] text-fg-red">
                        {rowError}
                      </span>
                    )}
                  </div>

                  {canWrite && (
                    <div className="flex shrink-0 items-center gap-0.5">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`Поднять «${plan.title}» выше`}
                        title="Выше"
                        disabled={index === 0 || rowBusy !== null}
                        onClick={() => void move(plan.id, "up")}
                      >
                        <ArrowUp className="size-3.5" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`Опустить «${plan.title}» ниже`}
                        title="Ниже"
                        disabled={index === plans.length - 1 || rowBusy !== null}
                        onClick={() => void move(plan.id, "down")}
                      >
                        <ArrowDown className="size-3.5" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`Изменить «${plan.title}»`}
                        title="Изменить"
                        disabled={rowBusy !== null}
                        onClick={() => {
                          setFormVersion((current) => current + 1);
                          setPlanForm({ plan });
                        }}
                      >
                        <Pencil className="size-3.5" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`Удалить «${plan.title}»`}
                        title="Удалить"
                        className="hover:bg-bg-red-light hover:text-fg-red"
                        disabled={rowBusy !== null}
                        onClick={() => setPendingDeleteId(plan.id)}
                      >
                        {rowBusy?.kind === "delete" ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="size-3.5" />
                        )}
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </>
      )}

      {/*
        Форма строки графика монтируется всегда, но открыта только при выбранной
        строке: так её состояние (поля, ошибка, признак отправки) живёт внутри неё,
        а список не знает ни о валидации, ни о статусах отправки. `key` даёт
        чистый старт каждому открытию — приём тот же, что у диалога загрузки файла.
      */}
      <PaymentPlanForm
        key={`${specItemId}:${planForm?.plan?.id ?? "new"}:${formVersion}`}
        open={planForm !== null}
        plan={planForm?.plan ?? null}
        onClose={() => setPlanForm(null)}
        onSubmit={submitPlan}
      />

      <PaymentForm
        key={`${specItemId}:${paymentForm?.payment?.id ?? "new"}:${formVersion}`}
        open={paymentForm !== null}
        payment={paymentForm?.payment ?? null}
        plans={plans}
        onClose={() => setPaymentForm(null)}
        onSubmit={submitPayment}
      />

      {/*
        Подтверждение удаления строки графика — один диалог на вкладку, а не свой
        у каждой строки: иначе в списке одновременно жило бы столько невидимых
        диалогов, сколько строк.
      */}
      <AlertDialog
        open={pendingDeleteId !== null}
        onOpenChange={(next) => !next && setPendingDeleteId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить платёж из графика?</AlertDialogTitle>
            <AlertDialogDescription>
              {/* Название — из списка: строку могли удалить с другой вкладки,
                  тогда текст остаётся общим, без пустых кавычек. */}
              {pendingDeletePlan
                ? `«${pendingDeletePlan.title}» исчезнет из графика. Стоимость позиции и её статус не изменятся.`
                : "Строка исчезнет из графика. Стоимость позиции и её статус не изменятся."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void removePlan()}
              disabled={busyHere?.kind === "delete"}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {busyHere?.kind === "delete" && (
                <Loader2 className="mr-2 size-4 animate-spin" />
              )}
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/*
        Отмена оплаты — мягкое удаление: запись остаётся в журнале позиции, но
        больше не считается в суммах. Текст отличается для чужой записи: тот, кто
        правит не своё, должен это видеть.
      */}
      <AlertDialog
        open={pendingCancelId !== null}
        onOpenChange={(next) => !next && setPendingCancelId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Отменить оплату?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingCancelPayment
                ? `${fmtRub(pendingCancelPayment.amount)} от ${dateLabel(pendingCancelPayment.paidAt)} перестанут считаться в суммах. Запись останется в истории позиции.`
                : "Запись перестанет считаться в суммах, но останется в истории позиции."}
              {pendingCancelPayment &&
                isForeignPayment({
                  userId: currentUserId,
                  createdBy: pendingCancelPayment.authorId,
                }) &&
                " Это запись другого участника."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Не отменять</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void cancelPayment()}
              disabled={busyHere?.kind === "cancel"}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {busyHere?.kind === "cancel" && (
                <Loader2 className="mr-2 size-4 animate-spin" />
              )}
              Отменить оплату
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
