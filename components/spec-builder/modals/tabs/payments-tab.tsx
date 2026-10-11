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
import { listSpecItemFiles } from "@/actions/spec-item-files";
import type { SpecItemFileEntry } from "@/lib/spec/spec-item-files";
import { paymentPlanCoverage, paymentProgress, summarisePaymentSchedule } from "@/lib/spec/payment-schedule";
import { canMutatePayment, canRecordPayment, isForeignPayment } from "@/lib/spec/payment-permissions";
import { PAYMENT_KIND_LABEL } from "@/lib/spec/payment-types";
import type { PaymentEntry } from "@/lib/spec/payment-types";
import type { PaymentPlanEntry } from "@/lib/spec/payment-plan-types";
import type { OrgRole } from "@/lib/permissions";
import DocumentList from "./document-list";
import { useStoredFileList } from "./use-file-list";
import PaymentPlanForm, {
  type PaymentPlanFormValues,
} from "./payment-plan-form";
import PaymentForm, { type PaymentFormValues } from "./payment-form";

/**
 * Вкладка «Платежи» карточки материала: прогресс оплаты и фактические записи.
 *
 * ── Что здесь есть ─────────────────────────────────────────────────────────
 *
 * 1. прогресс от стоимости позиции: сколько стоит, сколько оплачено, сколько
 *    осталось, процент и полоса; рядом — возвраты и пометка «возвратов больше,
 *    чем оплат»;
 * 2. факты: вид записи, дата, сумма, привязка к строке графика, комментарий,
 *    автор и действия по правам;
 * 3. документы к оплате — чек, поручение, счёт: прикрепление, открытие и
 *    удаление прямо из карточки факта;
 * 4. форма записи — оплата или возврат, с вводом суммы числом или процентом.
 *
 * ── Документы к оплате ─────────────────────────────────────────────────────
 *
 * Документ — это ОБЫЧНЫЙ файл позиции (`spec_item_files`) со ссылкой на оплату,
 * а не вторая сущность: и вкладка «Файлы», и карточка факта показывают одну и ту
 * же строку. Поэтому список файлов читается здесь тем же действием
 * (`listSpecItemFiles`), а у каждой записи монтируется ТОТ ЖЕ список, что во
 * вкладке «Файлы» (`DocumentList`), с фильтром по `paymentId`.
 *
 * Показывается он компактным вариантом: чипсы видов, приглашение прикрепить и
 * шаг «Счёт / Чек» после приёма файла. Групп, фильтров и строк документа у оплаты
 * нет — у одной проводки документов единицы, а управление документом живёт в
 * одном месте, во вкладке «Файлы». Строка оплаты остаётся точкой прикрепления:
 * перетаскивание на неё и плейсхолдер-чипс.
 *
 * Роль документа к оплате несёт вид (`invoice` — основание, `receipt` —
 * подтверждение, ADR 0005), а формат её не различает, поэтому у оплаты вид
 * называет человек: он спрашивается шагом сразу после приёма файла и уходит на
 * сервер явным `category`, перебивая серверную догадку.
 *
 * Права у документов файловые (`record:create`): приложить чек к чужой оплате
 * может любой участник, кроме наблюдателя, — это решение тикета, и оно
 * отличается от права правки самой записи.
 *
 * ── График платежей в интерфейсе не участвует ──────────────────────────────
 *
 * Решение интервью 2026-10-10: обязательство не ведётся строками графика, а
 * остаток считается от стоимости позиции (`paymentProgress`). Таблица графика,
 * кнопка «Добавить платёж» и форма строки выведены из рендера; код, действия и
 * данные сохранены, поэтому возврат блока обратим.
 *
 * ── Почему данные грузятся вкладкой, а не приходят пропсом ─────────────────
 *
 * Тем же приёмом, что «Файлы» и «Комментарии»: у вкладки собственный запрос в
 * локальное состояние. Конструктор держит `items` в `useState`, синхронизации с
 * пропсами нет, и `revalidatePath` из action до открытой модалки не доходит —
 * полагаться на него здесь нельзя. Поэтому список фактов обновляется из ответов
 * действий (они возвращают записанную строку).
 *
 * ── Почему один запрос на две таблицы ──────────────────────────────────────
 *
 * Факты и строки графика читаются ВМЕСТЕ (`Promise.all`) и обновляются вместе.
 * Причина историческая: покрытие строки считалось из фактов, и список фактов,
 * показанный рядом со старым графиком, давал бы неверные остатки. Пока график
 * скрыт, второй список не показывается, но читается: привязка факта к строке
 * сохраняется в записи и должна быть целой, если блок вернут.
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
 * Превью у чипсов нет: ссылок не подписываем.
 *
 * Контракт `DocumentList` один на оба варианта, поэтому пустая карта и обработчик
 * без работы передаются явно — «миниатюр здесь нет» это не отсутствие пропсов, а
 * их пустое значение. Ссылки подписывает вкладка «Файлы»: там превью видны.
 */
const NO_THUMBS: Record<string, string> = {};

function ignoreThumbFailure() {
  // Превью не рисуется, значит и сообщать о неудачной картинке нечего.
}

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
  /**
   * Документы позиции — все, а не только приложенные к оплате.
   *
   * Фильтровать на сервере значило бы завести отдельный запрос «документы
   * оплаты» рядом с общим списком файлов, а второй список той же таблицы
   * разошёлся бы с первым. Здесь документ выбирается по `paymentId`, и в
   * карточке оплаты показываются ровно его документы.
   *
   * Список ведёт хук (`use-file-list`): он же даёт оптимистичные правки, поэтому
   * удаление документа исчезает из строки сразу, а отказ сервера возвращает его.
   */
  const { files, apply: applyFile, mutate: mutateFile } = useStoredFileList();
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
   * Номера открытий форм: входят в их `key`.
   *
   * Без них повторное «Добавить платёж» после закрытия формы получило бы тот же
   * key, что у прошлого открытия, — и React не пересоздал бы компонент, оставив
   * в полях значения прошлой строки.
   *
   * Счётчики РАЗНЫЕ у двух форм. Общий счётчик — не мелочь: обе формы
   * смонтированы всегда (открыта из них одна), и одно «Добавить платёж» меняло
   * бы key ещё и закрытой формы оплаты, сбрасывая введённое в ней. Больше того,
   * при общем счётчике ключи двух форм совпадали (`<позиция>:new:<номер>`) —
   * React предупреждал о дубле ключей у детей одного родителя.
   */
  const [planFormVersion, setPlanFormVersion] = useState(0);
  const [paymentFormVersion, setPaymentFormVersion] = useState(0);
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

  /* ------------------------------------------------------------------ */
  /*  Документы к оплате                                                 */
  /* ------------------------------------------------------------------ */

  /**
   * Ответы списка документов.
   *
   * Сам список живёт в `use-file-list` — он же ведёт его во вкладке «Файлы»: у
   * документов оплаты и документов позиции один вид, одни группы, один фильтр и
   * одно правило обновления. Здесь только состояние файлов позиции, из которого
   * каждая оплата берёт свои.
   */
  const onFileUploaded = useCallback(
    (entry: SpecItemFileEntry) => applyFile({ type: "uploaded", entry }),
    [applyFile],
  );

  const onFileChanged = useCallback(
    (entry: SpecItemFileEntry) => applyFile({ type: "changed", entry }),
    [applyFile],
  );

  const onFileDeleted = useCallback(
    (fileId: string) => applyFile({ type: "deleted", fileId }),
    [applyFile],
  );

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
      const [plansRes, paymentsRes, filesRes] = await Promise.all([
        listPaymentPlans(orgSlug, forItem),
        listPayments(orgSlug, forItem),
        listSpecItemFiles(orgSlug, forItem),
      ]);

      if (requestId !== requestIdRef.current) return null;
      if (!plansRes.success) return { ok: false as const, message: plansRes.error };
      if (!paymentsRes.success) {
        return { ok: false as const, message: paymentsRes.error };
      }
      if (!filesRes.success) {
        return { ok: false as const, message: filesRes.error };
      }

      return {
        ok: true as const,
        plans: plansRes.data,
        payments: paymentsRes.data,
        files: filesRes.data,
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
        applyFile({ type: "replace", files: result.files });
        setLoadedKey(specItemId);
        setError(null);
      } else {
        setError(result.message);
      }
    },
    [applyFile, specItemId],
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

  /*
    Миниатюр документов здесь нет намеренно: список у оплаты компактный (чипсы
    видов), а чипс рисуется одним текстом. Ссылки на превью подписывает вкладка
    «Файлы» — `useSignedThumbnails` там, где превью действительно видны; лишний
    вызов подписи на каждый файл позиции ради невидимых картинок не нужен.
  */

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

  /**
   * Прогресс оплаты от стоимости позиции: сколько стоит, сколько оплачено,
   * сколько осталось и какой это процент.
   *
   * Считается тем же модулем, что и сводка, поэтому «оплачено» здесь и в
   * сводке — одна величина, а не две похожие.
   */
  const progress = paymentProgress(
    itemCost ?? 0,
    payments.map((payment) => ({
      paymentPlanId: payment.paymentPlanId,
      amount: payment.amount,
      kind: payment.kind,
      deletedAt: null,
    })),
  );

  /**
   * Ширины полосы прогресса в процентах.
   *
   * Оплаченная доля не длиннее всей полосы, а превышение показывается отдельным
   * красным отрезком вплотную к ней: полоса «120 % ширины» ничего не сообщает, а
   * «сколько именно сверху» видно из подписи переплаты.
   */
  const paidBarPct = progress.percent ?? 0;
  const overpaidBarPct =
    progress.total > 0
      ? Math.min(
          Math.round(
            ((100 - paidBarPct) * progress.overpaid) / progress.total,
          ),
          100 - paidBarPct,
        )
      : 0;

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
            Стоимость, прогресс и остаток.

            База — стоимость позиции, а не сумма графика: это осознанный откат
            решения ADR 0003 (см. `paymentProgress` в `lib/spec/payment-schedule`
            и ADR). Следствие принято явно: при смене цены, количества или
            скидок «осталось» изменится без единой новой оплаты.

            График платежей в интерфейсе не участвует вовсе — блок убран ниже.
            Данные графика при этом сохранены.
          */}
          <div
            /*
              `data-testid` — по той же причине, что в модалке закупки: карточка
              это `div` без роли и без единого текстового узла (подписи и числа
              лежат в разных `span`), поэтому ни роль, ни текст не дают тесту
              устойчивой точки опоры.
            */
            data-testid="payments-progress"
            className="flex flex-col gap-2.5 rounded-xl border border-border-muted bg-bg-card2 px-4 py-3.5"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-[12.5px] text-fg-muted">
                Стоимость материала
              </span>
              <span className="text-[17px] font-bold tabular-nums">
                {fmtRub(progress.total)}
              </span>
            </div>

            {/*
              Полоса: зелёная — оплаченная доля стоимости, красная — превышение
              над ней. Ширины считаются от стоимости, поэтому полоса не «врёт»
              при переплате: зелёная часть не длиннее всей полосы.
            */}
            <div className="flex h-2.5 overflow-hidden rounded-full bg-bg-select">
              <div
                className="bg-fg-green"
                style={{ width: `${paidBarPct}%` }}
              />
              {progress.overpaid > 0 && (
                <div
                  className="bg-fg-red"
                  style={{ width: `${overpaidBarPct}%` }}
                />
              )}
            </div>

            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-[13px] text-fg-green">
                Оплачено:{" "}
                <span className="font-mono tabular-nums text-fg">
                  {fmtRub(progress.paid)}
                </span>
                {progress.percent !== null && (
                  <span className="ml-1.5 text-fg-dim">
                    · {progress.percent} %
                  </span>
                )}
              </span>
              {progress.overpaid > 0 ? (
                <span className="text-[13px] text-fg-red">
                  Переплата:{" "}
                  <span className="font-mono tabular-nums">
                    {fmtRub(progress.overpaid)}
                  </span>
                </span>
              ) : (
                <span className="text-[13px] text-fg-muted">
                  Осталось:{" "}
                  <span className="font-mono tabular-nums text-fg">
                    {fmtRub(progress.remaining)}
                  </span>
                </span>
              )}
            </div>

            {/*
              Возвраты — отдельной строкой, а не только уменьшением итога: иначе
              уменьшение оплаченного выглядит как правка истории.
            */}
            {summary.refunded !== 0 && (
              <span className="text-[12px] text-fg-red">
                Возвраты:{" "}
                <span className="font-mono tabular-nums">
                  {fmtRub(summary.refunded)}
                </span>
              </span>
            )}
          </div>

          {/*
            Возвратов больше, чем оплат (решение Q13): случай БД не запрещает и
            причины не требует, поэтому это не ошибка ввода, а состояние. Но
            `paid` в нём отрицателен, и без объяснения отрицательное «Оплачено»
            читалось бы как сбой расчёта. Пометка стоит сразу под сводкой —
            рядом с той величиной, которую она объясняет.
          */}
          {summary.refundsExceedPayments && (
            <div
              role="alert"
              className="flex flex-col gap-0.5 rounded-xl border border-border-red bg-bg-red-light px-3.5 py-2.5"
            >
              <span className="text-[12.5px] font-medium text-fg-red">
                Возвратов больше, чем оплачено
              </span>
              <span className="text-[12px] text-fg-muted">
                Оплачено {fmtRub(summary.paidGross)}, вернули{" "}
                {fmtRub(summary.refunded)} — то есть вернули больше, чем
                получили. Запись сохранена: причина возврата не требуется.
              </span>
            </div>
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
                  setPaymentFormVersion((current) => current + 1);
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
                      {/*
                        Привязка к строке графика больше НЕ показывается: график
                        выведен из интерфейса, и «без плана · вне графика» рядом
                        с невидимым графиком читалось бы как загадка. Сама
                        привязка в записи сохраняется — см. `paymentProgress` и
                        ADR 0003.
                      */}
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

                  {(canWrite || editable) && (
                    <div className="flex shrink-0 items-center gap-0.5">
                      {editable && (
                        <>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label={`Изменить оплату от ${dateLabel(payment.paidAt)}`}
                            title="Изменить"
                            disabled={rowBusy !== null}
                            onClick={() => {
                              setPaymentFormVersion((current) => current + 1);
                              setPaymentForm({
                                payment,
                                // Ключ правке не нужен: она не создаёт запись.
                                // Но поле обязано быть — форма одна на оба
                                // случая.
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
                        </>
                      )}
                    </div>
                  )}
                </div>

                {/*
                  Документы этой оплаты — ТЕМ ЖЕ компонентом, что во вкладке
                  «Файлы», но компактным вариантом: чипсы видов, приглашение и
                  шаг выбора вида. Один список, две точки входа, одно правило
                  загрузки — отличается ровно выборка (`paymentId`) и показ.

                  Почему компактно: большая пунктирная рамка загрузки в каждой
                  карточке оплаты занимала строку и читалась как пустое место,
                  хотя несла одну кнопку. Чипс при этом ничего не делает —
                  открыть, скачать, переименовать, сменить вид и удалить документ
                  можно только во вкладке «Файлы», соседней вкладке модалки.

                  Строка остаётся точкой прикрепления: перетаскивание на неё и
                  плейсхолдер-чипс в ней. Без этого документ оплаты нельзя было
                  бы создать перетаскиванием ниоткуда — вкладка «Файлы» пишет
                  `payment_id = ""`.

                  Показывается и наблюдателю: чтение файлов правами не
                  описывается, а документ к оплате — часть суммы, которую
                  наблюдатель видит. Ни приглашения, ни шага выбора вида он не
                  получит: гейт — тот же `canWrite`.
                */}
                <div className="border-t border-border-muted pt-1.5">
                  <DocumentList
                    orgSlug={orgSlug}
                    specItemId={specItemId}
                    files={files.filter((file) => file.paymentId === payment.id)}
                    loading={false}
                    thumbs={NO_THUMBS}
                    onThumbFailed={ignoreThumbFailure}
                    paymentId={payment.id}
                    canWrite={canWrite}
                    variant="chips"
                    onUploaded={onFileUploaded}
                    onChanged={onFileChanged}
                    onDeleted={onFileDeleted}
                    mutate={mutateFile}
                    title={null}
                  />
                </div>
              </div>
            );
          })}

          {/*
            ── Блок графика платежей убран из интерфейса ──────────────────────
            Решение интервью 2026-10-10: оплаты считаются от стоимости позиции
            (`paymentProgress` выше), а вести график платежей не нужно.

            Убрано ЧТО ПОКАЗЫВАЕТСЯ, а не что хранится: таблица графика, кнопка
            «Добавить платёж», форма строки графика и её подтверждение удаления
            остаются в `payment-plan-*`; данные в БД не тронуты. Вернуть блок —
            значит вернуть его рендер, а не восстанавливать данные.

            Привязка факта к строке графика (`paymentPlanId`) сохраняется в
            записи: она больше не показывается, но и не теряется.
          */}
        </>
      )}

      {/*
        Форма строки графика монтируется всегда, но открыта только при выбранной
        строке: так её состояние (поля, ошибка, признак отправки) живёт внутри неё,
        а список не знает ни о валидации, ни о статусах отправки. `key` даёт
        чистый старт каждому открытию — приём тот же, что у диалога загрузки файла.
      */}
      <PaymentPlanForm
        key={`${specItemId}:plan:${planForm?.plan?.id ?? "new"}:${planFormVersion}`}
        open={planForm !== null}
        plan={planForm?.plan ?? null}
        onClose={() => setPlanForm(null)}
        onSubmit={submitPlan}
      />

      <PaymentForm
        key={`${specItemId}:payment:${paymentForm?.payment?.id ?? "new"}:${paymentFormVersion}`}
        open={paymentForm !== null}
        payment={paymentForm?.payment ?? null}
        plans={plans}
        itemCost={itemCost}
        remaining={progress.remaining}
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
