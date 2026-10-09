"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  CalendarPlus,
  Loader2,
  Pencil,
  Plus,
  Trash2,
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
import { paymentPlanDeadline } from "@/lib/spec/service-operation-deadline";
import { summarisePaymentSchedule } from "@/lib/spec/payment-schedule";
import type { PaymentPlanEntry } from "@/lib/spec/payment-plan-types";
import PaymentPlanForm, {
  type PaymentPlanFormValues,
} from "./payment-plan-form";

/**
 * Вкладка «Платежи» карточки материала: график платежей позиции.
 *
 * ── Что здесь есть ─────────────────────────────────────────────────────────
 *
 * Сводка по графику, строки графика и четыре действия: добавить, изменить,
 * переставить, удалить (мягко). Фактических оплат в этой задаче нет — их
 * добавляет следующая, — поэтому «оплачено» здесь ноль по построению, а не по
 * расчёту: `summarisePaymentSchedule` принимает факты аргументом и вернёт их,
 * когда они появятся.
 *
 * ── Почему данные грузятся вкладкой, а не приходят пропсом ─────────────────
 *
 * Тем же приёмом, что «Файлы» и «Комментарии»: у вкладки собственный запрос в
 * локальное состояние. Конструктор держит `items` в `useState`, синхронизации с
 * пропсами нет, и `revalidatePath` из action до открытой модалки не доходит —
 * полагаться на него здесь нельзя. Поэтому список обновляется из ответов
 * действий (они возвращают записанную строку) и повторным чтением после
 * перестановки, где меняется не одна строка.
 *
 * ── Порядок ────────────────────────────────────────────────────────────────
 *
 * Список НЕ сортируется на клиенте: сервер отдаёт строки по `position`, `id`
 * (индекс `spec_item_payment_plans_position_uidx`), и клиентская сортировка была
 * бы вторым, расходящимся правилом порядка. Перестановка — на одну позицию
 * вверх или вниз; у крайних строк кнопка выключена, потому что переставлять
 * нечего.
 */

/** Сколько строк-заготовок показывать при загрузке. */
const SKELETON_ROWS = 3;

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
function dueDateLabel(dueDate: string): string {
  return new Date(`${dueDate}T00:00:00`).toLocaleDateString("ru-RU", {
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
  tone?: "default" | "muted";
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="font-mono text-[10.5px] uppercase tracking-wider text-fg-muted">
        {label}
      </span>
      <span
        className={cn(
          "font-mono text-[13.5px] tabular-nums",
          tone === "muted" ? "text-fg-dim" : "text-fg",
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
  /** Стоимость позиции — справка. Остаток от неё не считается (решение Q1). */
  itemCost,
}: {
  /** Слаг организации: организация берётся на сервере из сессии, не с клиента. */
  orgSlug: string;
  /** Позиция, чей график ведём. */
  specItemId: string;
  itemCost?: number;
}) {
  const [plans, setPlans] = useState<PaymentPlanEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  /** Для какой позиции пришли `plans`. Не совпало с текущей — идёт загрузка. */
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  /** Идёт ли запрос прямо сейчас: нужен кнопке «Повторить». */
  const [inFlight, setInFlight] = useState(false);

  /** Форма: `null` — закрыта; `{ plan: null }` — создание, иначе правка. */
  const [form, setForm] = useState<{
    plan: PaymentPlanEntry | null;
  } | null>(null);
  /**
   * Номер открытия формы: входит в её `key`.
   *
   * Без него повторное «Добавить платёж» после закрытия формы получило бы тот же
   * key, что у прошлого открытия, — и React не пересоздал бы компонент, оставив
   * в полях значения прошлой строки. Счётчик делает каждое открытие новым
   * монтированием, поэтому сбрасывать поля эффектом не приходится.
   */
  const [formVersion, setFormVersion] = useState(0);
  /** Строка, для которой открыто подтверждение удаления. */
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  /** Идёт операция над строкой: кнопки этой строки выключены. */
  const [busy, setBusy] = useState<{
    itemKey: string;
    planId: string;
    kind: "move" | "delete";
  } | null>(null);
  /** Ошибка действия — у своей строки, чтобы список продолжал работать. */
  const [actionError, setActionError] = useState<{
    itemKey: string;
    planId: string | null;
    message: string;
  } | null>(null);

  /** Номер попытки загрузки списка: гасит устаревшие ответы. */
  const requestIdRef = useRef(0);
  /**
   * Актуальная позиция для асинхронных ответов: колбэк, созданный в прошлой
   * отрисовке, держит в замыкании прежний `specItemId`.
   */
  const specItemIdRef = useRef(specItemId);
  useEffect(() => {
    specItemIdRef.current = specItemId;
  }, [specItemId]);

  /**
   * Загрузка списка: ничего не пишет в состояние сама, а возвращает результат —
   * поэтому её одинаково используют эффект и «Повторить».
   */
  const requestList = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    const forItem = specItemId;

    try {
      const res = await listPaymentPlans(orgSlug, forItem);
      if (requestId !== requestIdRef.current) return null;
      if (res.success) return { ok: true as const, plans: res.data };
      return { ok: false as const, message: res.error };
    } catch (cause) {
      // Server action может отклониться, не дойдя до `ActionResult` (сеть):
      // для UI это то же самое «не удалось».
      if (requestId !== requestIdRef.current) return null;
      console.error("[PaymentsTab] график платежей", cause);
      return { ok: false as const, message: "Не удалось загрузить график" };
    }
  }, [orgSlug, specItemId]);

  const applyList = useCallback(
    (result: Awaited<ReturnType<typeof requestList>>) => {
      // `null` — устаревший ответ: он не должен перезаписать список актуального.
      if (result === null) return;

      if (result.ok) {
        setPlans(result.plans);
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
    void requestList()
      .then(applyList)
      .finally(() => setInFlight(false));
  }, [requestList, applyList]);

  useEffect(() => {
    void requestList().then(applyList);
    // Смена позиции и размонтирование отменяют ответы прошлых запросов: номер
    // попытки растёт, и поздний ответ уже не актуален.
    return () => {
      requestIdRef.current += 1;
    };
  }, [requestList, applyList]);

  const isCurrent = loadedKey === specItemId;
  const loading = !isCurrent && (error === null || inFlight);
  const failed = !isCurrent && error !== null && !inFlight;

  const busyHere = busy?.itemKey === specItemId ? busy : null;
  const actionErrorHere =
    actionError?.itemKey === specItemId ? actionError : null;

  const pendingDeletePlan =
    plans.find((plan) => plan.id === pendingDeleteId) ?? null;

  /**
   * Сводка графика. Считается из ТЕХ ЖЕ строк, что видит пользователь, — по
   * чистому модулю `payment-schedule`, а не по второй формуле в разметке.
   */
  const summary = summarisePaymentSchedule(
    plans.map((plan) => ({
      id: plan.id,
      amount: plan.amount,
      position: plan.position,
      deletedAt: null,
    })),
    // Фактических оплат в этой задаче нет: их добавляет следующая.
    [],
  );

  /** Сохранение формы: создание или правка — по тому, что открыто. */
  const submitForm = useCallback(
    async (values: PaymentPlanFormValues) => {
      const editing = form?.plan ?? null;
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
        setForm(null);
        setActionError(null);
        return null;
      } catch (cause) {
        if (specItemIdRef.current !== forItem) return null;
        console.error("[PaymentsTab] сохранение платежа", cause);
        return "Не удалось сохранить платёж";
      }
    },
    [form, orgSlug, specItemId],
  );

  /**
   * Перестановка на одну позицию.
   *
   * После успеха список ПЕРЕЧИТЫВАЕТСЯ: перестановка меняет номер не у одной
   * строки, и собирать новый порядок на клиенте значило бы завести вторую
   * формулу порядка рядом с серверной.
   */
  const move = useCallback(
    async (planId: string, direction: "up" | "down") => {
      const forItem = specItemId;
      setBusy({ itemKey: forItem, planId, kind: "move" });
      setActionError(null);

      try {
        const res = await movePaymentPlan(orgSlug, forItem, planId, direction);
        if (specItemIdRef.current !== forItem) return;

        if (!res.success) {
          setActionError({ itemKey: forItem, planId, message: res.error });
          return;
        }

        // Переставлять некуда — не ошибка: список остаётся как есть.
        if (!res.data.moved) return;

        const list = await requestList();
        if (specItemIdRef.current !== forItem) return;
        applyList(list);
      } catch (cause) {
        if (specItemIdRef.current !== forItem) return;
        console.error("[PaymentsTab] перестановка платежа", cause);
        setActionError({
          itemKey: forItem,
          planId,
          message: "Не удалось переставить платёж",
        });
      } finally {
        if (specItemIdRef.current === forItem) setBusy(null);
      }
    },
    [applyList, orgSlug, requestList, specItemId],
  );

  /** Удаление строки: строка исчезает только после успешного ответа. */
  const remove = useCallback(async () => {
    const planId = pendingDeleteId;
    if (!planId) return;
    if (busy?.planId === planId && busy.kind === "delete") return;

    const forItem = specItemId;
    setBusy({ itemKey: forItem, planId, kind: "delete" });
    setActionError(null);

    try {
      const res = await deletePaymentPlan(orgSlug, forItem, planId);
      if (specItemIdRef.current !== forItem) return;

      if (!res.success) {
        // Диалог закрываем: иначе он висел бы поверх списка, а сообщение об
        // ошибке и сама строка были бы под ним.
        setPendingDeleteId(null);
        setActionError({ itemKey: forItem, planId, message: res.error });
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
        planId,
        message: "Не удалось удалить платёж",
      });
    } finally {
      if (specItemIdRef.current === forItem) setBusy(null);
    }
  }, [busy, orgSlug, pendingDeleteId, specItemId]);

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
            Сводка. «Оплачено», «Остаток» и «Переплата» здесь есть несмотря на
            то, что фактов пока нет: это величины графика, и следующая задача
            добавляет к ним данные, а не строки. Ноль в них — честное значение,
            а не заглушка.
          */}
          <div className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl border border-border-muted bg-bg-card2 px-3.5 py-3 sm:grid-cols-4">
            <SummaryCell label="План" value={fmtRub(summary.planned)} />
            <SummaryCell
              label="Оплачено"
              value={fmtRub(summary.paid)}
              tone="muted"
            />
            <SummaryCell
              label="Остаток"
              value={fmtRub(summary.remaining)}
            />
            <SummaryCell
              label="Переплата"
              value={fmtRub(summary.overpaid)}
              tone="muted"
            />
          </div>

          {/*
            Стоимость позиции — справка рядом с графиком, а не база остатка
            (решение Q1). Подпись называет источник: цена и количество позиции
            считаются отдельно и на график не влияют.
          */}
          {itemCost !== undefined && (
            <p className="px-1 text-[11.5px] text-fg-dim">
              Стоимость позиции:{" "}
              <span className="font-mono">{fmtRub(itemCost)}</span> — справка,
              остаток от неё не считается
            </p>
          )}

          <div className="flex items-center justify-between gap-2 px-1">
            <span className="text-[11.5px] text-fg-muted">
              {plans.length > 0
                ? `Строк в графике: ${plans.length}`
                : "График платежей пуст"}
            </span>
            <Button
              type="button"
              variant="outline"
              className="shrink-0 gap-1.5"
              onClick={() => {
                setFormVersion((current) => current + 1);
                setForm({ plan: null });
              }}
            >
              <Plus className="size-3.5" />
              Добавить платёж
            </Button>
          </div>

          {actionErrorHere && actionErrorHere.planId === null && (
            <p role="alert" className="px-1 text-[12px] text-fg-red">
              {actionErrorHere.message}
            </p>
          )}

          {plans.length === 0 && (
            <div className="flex flex-col items-center gap-1.5 rounded-xl border-2 border-dashed border-border-muted px-4 py-8 text-center">
              <CalendarPlus
                className="size-5 text-fg-dim"
                aria-hidden="true"
              />
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
            const rowBusy = busyHere?.planId === plan.id ? busyHere : null;
            const rowError =
              actionErrorHere?.planId === plan.id ? actionErrorHere.message : null;

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
                          до {dueDateLabel(plan.dueDate)}
                          {deadline ? ` · ${deadline.text}` : ""}
                        </span>
                      )}
                    </div>

                    {rowError && (
                      <span role="alert" className="text-[12px] text-fg-red">
                        {rowError}
                      </span>
                    )}
                  </div>

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
                        setForm({ plan });
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
                </div>
              </div>
            );
          })}
        </>
      )}

      {/*
        Форма монтируется всегда, но открыта только при выбранной строке: так её
        состояние (поля, ошибка, признак отправки) живёт внутри неё, а список не
        знает ни о валидации, ни о статусах отправки. `key` даёт чистый старт
        каждому открытию — приём тот же, что у диалога загрузки файла.
      */}
      <PaymentPlanForm
        key={`${specItemId}:${form?.plan?.id ?? "new"}:${formVersion}`}
        open={form !== null}
        plan={form?.plan ?? null}
        onClose={() => setForm(null)}
        onSubmit={submitForm}
      />

      {/*
        Подтверждение удаления — один диалог на вкладку, а не свой у каждой
        строки: иначе в списке одновременно жило бы столько невидимых диалогов,
        сколько строк.
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
              onClick={() => void remove()}
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
    </div>
  );
}
