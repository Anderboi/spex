"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarClock,
  Check,
  Loader2,
  Pencil,
  Plus,
  Receipt,
  RotateCcw,
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
import { cn, fmtDate, fmtRub } from "@/lib/utils";
import {
  createPaymentPlan,
  listPaymentPlans,
  updatePaymentPlan,
} from "@/actions/spec-item-payment-plans";
import {
  createPayment,
  deletePayment,
  listPaymentCancellations,
  listPayments,
  updatePayment,
} from "@/actions/spec-item-payments";
import {
  deleteSpecItemFile,
  listSpecItemFiles,
  uploadSpecItemFile,
} from "@/actions/spec-item-files";
import type { SpecItemFileEntry } from "@/lib/spec/spec-item-files";
import type { PaymentPlanEntry } from "@/lib/spec/payment-plan-types";
import type { PaymentEntry } from "@/lib/spec/payment-types";
import {
  paymentProgress,
  summarisePaymentSchedule,
} from "@/lib/spec/payment-schedule";
import { buildPaymentRows, type PaymentRowEntry } from "@/lib/spec/payment-rows";
import { canMutatePayment, canRecordPayment, isForeignPayment } from "@/lib/spec/payment-permissions";
import type { OrgRole } from "@/lib/permissions";
import type {
  PaymentFormUpload,
  PaymentFormValues,
  PaymentPlanFormValues,
} from "@/lib/spec/payment-form-types";
import DocumentList from "./document-list";
import { useStoredFileList } from "./use-file-list";
import PaymentForm from "./payment-form";

/**
 * Вкладка «Платежи» карточки материала: график платежей и факты по нему.
 *
 * ── Что здесь есть ─────────────────────────────────────────────────────────
 *
 * 1. прогресс от стоимости позиции: сколько стоит, сколько оплачено, сколько
 *    осталось, процент и полоса; рядом — возвраты и пометка «возвратов больше,
 *    чем оплат»;
 * 2. СПИСОК ОБЯЗАТЕЛЬСТВ: строки графика и факты вне его — по строке на
 *    обязательство, а не на запись хранилища (см. ниже);
 * 3. документы — счёт к плану, чек к оплате: прикрепление, открытие и удаление
 *    прямо из строки;
 * 4. одна форма на всё: план, оплата, возврат и правка любой из них.
 *
 * ── Одна строка на экране, две в хранилище ─────────────────────────────────
 *
 * План и факт остаются разными строками БД (`spec_item_payment_plans` и
 * `spec_item_payments`), но на экран попадают ОДНОЙ строкой: список собирает
 * чистая функция `buildPaymentRows` (`lib/spec/payment-rows`), и вкладка о
 * правиле соединения не знает — она рисует готовые строки. Отметка «Оплачено»
 * поэтому не добавляет строку, а меняет состояние существующей; то же правило
 * объясняет, почему отменённая оплата возвращает строку в «Не оплачено», а не
 * исчезает вместе с обязательством.
 *
 * Состояние строки показывает МАРКЕР, а не цвет и не чипс вида: прежний чипс
 * «Оплата / Возврат» заменён маркером — два носителя одного смысла на экране не
 * показываются, а зелёная рамка оплаченной строки остаётся украшением поверх
 * маркера (цвет не должен быть единственным носителем смысла).
 *
 * ── Почему одна форма ──────────────────────────────────────────────────────
 *
 * План, оплата и возврат вводит один человек в одном месте. Две формы дали бы
 * две секции прикрепления документов и два выбора роли документа к оплате — то
 * есть два места, где спрашивается одно и то же. Поэтому входов несколько
 * («Внести оплату», «Запланировать платёж», «Внести возврат», «Оплачено» у
 * строки), а форма одна, и различает их пропс `markPaid`/`fixedKind`/`plan`.
 *
 * ── Остаток и процент не меняются ──────────────────────────────────────────
 *
 * Шапка блока считается от стоимости позиции и ТОЛЬКО по фактам
 * (`paymentProgress`): плановая сумма в неё не входит, отдельной величины
 * «запланировано» нет (ADR 0003, решение Q24). Следствие принято осознанно: у
 * неоплаченной строки видна сумма и срок, а «осталось» считается без них.
 *
 * ── Почему данные грузятся вкладкой, а не приходят пропсом ─────────────────
 *
 * Тем же приёмом, что «Файлы» и «Комментарии»: у вкладки собственный запрос в
 * локальное состояние. Конструктор держит `items` в `useState`, синхронизации с
 * пропсами нет, и `revalidatePath` из action до открытой модалки не доходит —
 * полагаться на него здесь нельзя. Поэтому списки обновляются из ответов
 * действий (они возвращают записанные строки).
 *
 * ── Отменённые оплаты читаются отдельно ────────────────────────────────────
 *
 * Отмена возвращает строку графика в «Не оплачено», но несёт пометку (решение
 * Q29). Пометку взять неоткуда: в списке живых фактов отменённых нет, поэтому
 * вкладка читает их ещё одним действием (`listPaymentCancellations`) и держит
 * рядом. Отказ этого чтения список не ломает: пометка — справка, а не данные.
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

/*
  Даты строк печатает общий форматтер проекта (`fmtDate`). Своего здесь нет
  намеренно: он был бы третьей копией одного правила, а календарную дату
  (`YYYY-MM-DD`) от момента времени `fmtDate` различает сам — иначе «оплачено
  15 октября» показывалось бы 14-м в поясах западнее Гринвича.
*/

/**
 * Заголовок строки: то, чем одно обязательство отличается от другого.
 *
 * У плана — его название, у факта вне графика — название не выдумывается:
 * `null` означает «оплата вне графика», и это состояние, а не отсутствие данных.
 */
function rowTitle(row: PaymentRowEntry): string | null {
  if (row.plan) return row.plan.title;
  return null;
}

/**
 * Маркер состояния строки: «Запланирован», «Оплачено» или «Возврат».
 *
 * Маркер, а не чипс вида записи: смысл состояния и смысл вида записи — одно и то
 * же, и показывать это двумя носителями значило бы говорить об одном дважды.
 * Иконка и текст несут смысл вместе с цветом: цвет не должен быть единственным
 * носителем (ADR 0006).
 */
function RowMarker({
  state,
  kind,
}: {
  state: "planned" | "paid" | "refund";
  /** Вид фактической записи, когда она есть: у возврата свой маркер. */
  kind?: "payment" | "refund";
}) {
  const refund = state === "refund" || kind === "refund";
  const label = refund ? "Возврат" : state === "planned" ? "Запланирован" : "Оплачено";
  const Icon = refund ? RotateCcw : state === "planned" ? CalendarClock : Check;

  return (
    <span
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1 rounded-full border px-2 text-[11.5px] font-medium",
        refund
          ? "border-border-red text-fg-red"
          : state === "planned"
            ? "border-border-muted bg-bg-card2 text-fg-secondary"
            : "border-border-accent bg-bg-green-light text-fg-green",
      )}
    >
      <Icon className="size-3" aria-hidden="true" />
      {label}
    </span>
  );
}

/** Что именно открыто в форме: входы разные, и у каждого свои данные. */
type FormState = {
  /** Правится карточка графика: она сама или `null` — заведение новой. */
  editingPlan: PaymentPlanEntry | null;
  /** Правится факт: запись или `null`. */
  editingPayment: PaymentEntry | null;
  /** Отметка «Оплачено» у этой карточки: создаём факт по известному платежу. */
  markPaidPlan: PaymentPlanEntry | null;
  /** Вид записи: возврат вносится своим входом. */
  fixedKind: "payment" | "refund";
  idempotencyKey: string;
};

/** То же без ключа: ключ генерирует `openForm` на каждое открытие. */
type FormIntent = Omit<FormState, "idempotencyKey">;

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
   * Отменённые оплаты — только ради пометки у строки графика.
   *
   * Их нет в живом списке (мягкое удаление исключает запись из сумм и из
   * списка), но правило «связь с отменённой оплатой показывается пометкой, а не
   * исчезает молча» продолжает действовать (решение Q29).
   */
  const [cancelled, setCancelled] = useState<PaymentEntry[]>([]);
  /**
   * Документы позиции — все, а не только приложенные к оплате.
   *
   * Фильтровать на сервере значило бы завести отдельный запрос «документы
   * оплаты» рядом с общим списком файлов, а второй список той же таблицы
   * разошёлся бы с первым. Здесь документ выбирается по ссылке, и в строке
   * показываются ровно его документы.
   *
   * Список ведёт хук (`use-file-list`): он же даёт оптимистичные правки, поэтому
   * удаление документа исчезает из строки сразу, а отказ сервера возвращает его.
   */
  const { files, apply: applyFile } = useStoredFileList();
  const [error, setError] = useState<string | null>(null);
  /** Для какой позиции пришли данные. Не совпало с текущей — идёт загрузка. */
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  /** Идёт ли запрос прямо сейчас: нужен кнопке «Повторить». */
  const [inFlight, setInFlight] = useState(false);

  /**
   * Открытая форма: `null` — закрыта.
   *
   * Состояние ЗАМОРАЖИВАЕТ то, что открыли: после успешной отметки «Оплачено» в
   * списке появляется факт, и по одному лишь списку форму уже не отличить от
   * «правки оплаты» — а она всё ещё создаёт новую запись, если пользователь
   * ошибся датой и правит тут же.
   */
  const [form, setForm] = useState<FormState | null>(null);
  /** Номер открытия формы: входит в её `key` и даёт чистый старт каждому входу. */
  const [formVersion, setFormVersion] = useState(0);
  /** Строка, для которой открыто подтверждение отмены оплаты. */
  const [pendingCancelId, setPendingCancelId] = useState<string | null>(null);
  /** Идёт операция: кнопки этой строки выключены. */
  const [busy, setBusy] = useState<{
    itemKey: string;
    rowId: string;
    kind: "cancel";
  } | null>(null);
  /** Ошибка действия — у своей строки, чтобы список продолжал работать. */
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
   * Загрузка списков: ничего не пишет в состояние сама, а возвращает результат —
   * поэтому её одинаково используют эффект и «Повторить».
   */
  const requestLists = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    const forItem = specItemId;

    try {
      const [plansRes, paymentsRes, filesRes, cancelledRes] = await Promise.all([
        listPaymentPlans(orgSlug, forItem),
        listPayments(orgSlug, forItem),
        listSpecItemFiles(orgSlug, forItem),
        listPaymentCancellations(orgSlug, forItem),
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
        /**
         * Отказ чтения отменённых список НЕ роняет: пометка — справка, а не
         * данные, и терять из-за неё факты и график нельзя.
         */
        cancelled: cancelledRes.success ? cancelledRes.data : [],
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
        setCancelled(result.cancelled);
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
    Миниатюр документов здесь нет намеренно: список у строки компактный (чипсы
    видов), а чипс рисуется одним текстом. Ссылки на превью подписывает вкладка
    «Файлы» — `useSignedThumbnails` там, где превью действительно видны.
  */

  const busyHere = busy?.itemKey === specItemId ? busy : null;
  const actionErrorHere =
    actionError?.itemKey === specItemId ? actionError : null;

  const cancelTarget =
    payments.find((payment) => payment.id === pendingCancelId) ?? null;
  /** Строка, у которой отменяют оплату: имя нужно тексту подтверждения. */
  const cancelPlanTitle = cancelTarget?.paymentPlanId
    ? (plans.find((plan) => plan.id === cancelTarget.paymentPlanId)?.title ?? null)
    : null;

  /**
   * Сводка и прогресс. Считаются из ТЕХ ЖЕ данных, что видит пользователь, — по
   * чистому модулю `payment-schedule`, а не по второй формуле в разметке.
   *
   * В арифметику входят ТОЛЬКО факты: `plans` здесь нужны лишь там, где модуль
   * складывает план (сводку шапка не показывает), а остаток считается от
   * стоимости позиции (ADR 0003).
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

  /**
   * Строки списка: план и факт — одна строка на экране.
   *
   * Соединение живёт в чистом модуле (`buildPaymentRows`), а не здесь: правило
   * ломается незаметно — лишняя строка не роняет вкладку, а показывает один и
   * тот же платёж дважды.
   */
  const rows = useMemo(
    () => buildPaymentRows({ plans, payments, cancelledPayments: cancelled }),
    [cancelled, payments, plans],
  );

  /* ------------------------------------------------------------------ */
  /*  Форма                                                             */
  /* ------------------------------------------------------------------ */

  /** Открыть форму в одном из входов: счётчик гарантирует чистый старт. */
  const openForm = useCallback((next: FormIntent) => {
    setFormVersion((current) => current + 1);
    setForm({
      ...next,
      // Ключ живёт от открытия формы до её закрытия: повторное нажатие
      // «Внести» отправляет тот же ключ, и второй оплаты не появляется.
      idempotencyKey: newIdempotencyKey(),
    });
  }, []);

  /**
   * Приложить выбранные документы к записанной строке.
   *
   * Отправляет их РОДИТЕЛЬ, а не форма: файл привязывается к идентификатору
   * записи, которого до сохранения ещё нет. Отсюда и текст предупреждения —
   * записи нет только у отказа, а здесь она уже есть (решение тикета: отказ
   * загрузки после создания оплаты оплату не отменяет).
   */
  const uploadAttachments = useCallback(
    async (
      uploads: PaymentFormUpload[],
      link: { paymentId: string | null; paymentPlanId: string | null },
      forItem: string,
    ): Promise<string | null> => {
      let failed = 0;

      for (const upload of uploads) {
        const formData = new FormData();
        formData.set("file", upload.file);
        formData.set("payment_id", link.paymentId ?? "");
        formData.set("payment_plan_id", link.paymentPlanId ?? "");
        formData.set("category", upload.category);

        try {
          const res = await uploadSpecItemFile(orgSlug, forItem, formData);
          if (specItemIdRef.current !== forItem) return null;
          if (!res.success) {
            failed += 1;
            continue;
          }
          applyFile({ type: "uploaded", entry: res.data });
        } catch (cause) {
          if (specItemIdRef.current !== forItem) return null;
          console.error("[PaymentsTab] загрузка документа", cause);
          failed += 1;
        }
      }

      if (failed === 0) return null;
      return failed === 1
        ? "Запись сохранена, но документ приложить не удалось: попробуйте ещё раз или приложите его во вкладке «Файлы»."
        : `Запись сохранена, но документы приложить не удалось (${failed}): приложите их во вкладке «Файлы».`;
    },
    [applyFile, orgSlug],
  );

  /**
   * Сохранение из формы: план, факт или правка — по тому, что открыто.
   *
   * Отказ возвращается текстом, предупреждение — отдельным полем: «записи нет» и
   * «запись есть, документы не приложились» требуют от пользователя разного.
   */
  const submitForm = useCallback(
    async (input: {
      payment: PaymentFormValues | null;
      plan: PaymentPlanFormValues | null;
      uploads: PaymentFormUpload[];
    }) => {
      const opened = form;
      if (!opened) return {};
      const forItem = specItemId;
      const editingPlan = opened.editingPlan;
      const editingPayment = opened.editingPayment;

      try {
        /* ── Карточка платежа ───────────────────────────────────────── */
        if (input.plan) {
          const res = editingPlan
            ? await updatePaymentPlan(orgSlug, forItem, editingPlan.id, input.plan)
            : await createPaymentPlan(orgSlug, forItem, input.plan);

          if (specItemIdRef.current !== forItem) return {};
          if (!res.success) return { error: res.error };

          // В список встаёт ЗАПИСЬ СЕРВЕРА, а не локальная догадка: порядок и
          // нормализованный текст — те же, что лежат в БД.
          setPlans((current) =>
            editingPlan
              ? current.map((plan) => (plan.id === res.data.id ? res.data : plan))
              : [...current, res.data],
          );

          const warning = await uploadAttachments(
            input.uploads,
            { paymentId: null, paymentPlanId: res.data.id },
            forItem,
          );
          if (warning) return { warning };

          setForm(null);
          setActionError(null);
          return {};
        }

        /* ── Факт ──────────────────────────────────────────────────── */
        if (input.payment) {
          const res = editingPayment
            ? await updatePayment(orgSlug, forItem, editingPayment.id, input.payment)
            : await createPayment(orgSlug, forItem, {
                ...input.payment,
                idempotencyKey: opened.idempotencyKey,
              });

          if (specItemIdRef.current !== forItem) return {};
          if (!res.success) return { error: res.error };

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
          /*
            Отметка «Оплачено» снимает пометку об отмене: у строки появился
            живой факт, и рассказывать про прошлую отмену больше нечего — она
            осталась в журнале позиции. Это же снимает и повтор записи, если её
            отменят снова позже.
          */
          if (res.data.paymentPlanId) {
            setCancelled((current) =>
              current.filter(
                (payment) => payment.paymentPlanId !== res.data.paymentPlanId,
              ),
            );

            /*
              И достраивает подпись счёта, приложенного к этой строке: у файла,
              связанного ТОЛЬКО с планом, второй ссылки нет, и «К оплате от …» он
              получает именно отсюда. Читать список файлов заново ради этого не
              нужно — дата только что записанного факта известна. Следующее
              чтение списка принесёт ту же дату с сервера (`paidPlans`).
            */
            const paidAt = res.data.paidAt;
            const planId = res.data.paymentPlanId;
            applyFile({
              type: "replace",
              files: files.map((file) =>
                file.paymentPlanId === planId && file.paymentPlan
                  ? { ...file, paymentPlan: { ...file.paymentPlan, paidAt } }
                  : file,
              ),
            });
          }

          // Связь с планом НЕ переписывается (ADR 0006: связи добавляются, а не
          // заменяются): документ уходит с той ссылкой, по которой его
          // прикладывали.
          const warning = await uploadAttachments(
            input.uploads,
            {
              paymentId: res.data.id,
              paymentPlanId: res.data.paymentPlanId,
            },
            forItem,
          );
          if (warning) return { warning };

          setForm(null);
          setActionError(null);
          return {};
        }

        return {};
      } catch (cause) {
        if (specItemIdRef.current !== forItem) return {};
        console.error("[PaymentsTab] сохранение записи", cause);
        return { error: "Не удалось сохранить запись" };
      }
    },
    [applyFile, files, form, orgSlug, specItemId, uploadAttachments],
  );

  /** Удалить приложенный документ прямо из формы. */
  const deleteAttachment = useCallback(
    async (file: SpecItemFileEntry): Promise<string | null> => {
      const forItem = specItemId;

      try {
        const res = await deleteSpecItemFile(orgSlug, forItem, file.id);
        if (specItemIdRef.current !== forItem) return null;
        if (!res.success) return res.error;

        applyFile({ type: "deleted", fileId: file.id });
        return null;
      } catch (cause) {
        if (specItemIdRef.current !== forItem) return null;
        console.error("[PaymentsTab] удаление документа", cause);
        return "Не удалось удалить файл";
      }
    },
    [applyFile, orgSlug, specItemId],
  );

  /* ------------------------------------------------------------------ */
  /*  Отмена оплаты                                                      */
  /* ------------------------------------------------------------------ */

  /**
   * Отмена оплаты: запись исчезает из списка только после успеха.
   *
   * Строка графика при этом НЕ меняется: живой факт уходит из списка, и
   * `buildPaymentRows` сам возвращает строку в «Не оплачено». Отменённая запись
   * встаёт в список отменённых — иначе обязательство выглядело бы так, будто его
   * никогда не закрывали (решение Q29).
   */
  const cancelPayment = useCallback(async () => {
    const paymentId = pendingCancelId;
    if (!paymentId) return;
    if (busy?.rowId === paymentId && busy.kind === "cancel") return;

    const target = payments.find((payment) => payment.id === paymentId) ?? null;
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
      if (target?.paymentPlanId) {
        setCancelled((current) => [target, ...current]);
      }
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
  }, [busy, orgSlug, payments, pendingCancelId, specItemId]);

  /* ------------------------------------------------------------------ */
  /*  Разметка                                                           */
  /* ------------------------------------------------------------------ */

  /**
   * Документы строки-обязательства.
   *
   * У неоплаченного плана это файлы со ссылкой на план, у факта — со ссылкой на
   * оплату. У ОПЛАЧЕННОЙ СТРОКИ ГРАФИКА показываются ОБЕ: счёт, приложенный к
   * плану до оплаты, остаётся её основанием и после отметки — связь добавилась,
   * а не заменилась (ADR 0006), — и пропади он из строки, основание пришлось бы
   * искать в другой вкладке.
   */
  const documentsFor = (row: PaymentRowEntry) => {
    if (row.payment) {
      const paymentId = row.payment.id;
      const planId = row.plan?.id ?? row.payment.paymentPlanId;
      return files.filter(
        (file) =>
          file.paymentId === paymentId ||
          (planId !== null && file.paymentPlanId === planId),
      );
    }

    return row.plan
      ? files.filter((file) => file.paymentPlanId === row.plan!.id)
      : [];
  };

  /** Документы, приложенные к правимой/отмечаемой записи — для формы. */
  const attachedForForm = useMemo(() => {
    if (!form) return [];
    if (form.editingPayment) {
      return files.filter((file) => file.paymentId === form.editingPayment!.id);
    }
    const plan =
      form.editingPlan ?? form.markPaidPlan ?? null;
    return plan ? files.filter((file) => file.paymentPlanId === plan.id) : [];
  }, [files, form]);

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

            База — стоимость позиции, а не сумма графика: плановая сумма в
            арифметике не участвует вовсе (ADR 0003, решение Q24). Следствие
            принято явно: при смене цены, количества или скидок «осталось»
            изменится без единой новой оплаты.
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
              <div className="bg-fg-green" style={{ width: `${paidBarPct}%` }} />
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

          {/* ── Обязательства: график и оплаты вне него ────────────────── */}
          <div className="flex flex-wrap items-center justify-between gap-2 px-1">
            <span className="flex items-center gap-1.5 text-[11.5px] text-fg-muted">
              <Wallet className="size-3.5" aria-hidden="true" />
              {rows.length > 0
                ? `Строк: ${rows.length}`
                : "График платежей пуст"}
            </span>

            {canWrite && (
              /*
                Доступное имя у группы входов — потому что «Внести возврат» есть и
                у кнопки наверху, и у кнопки отправки формы: без имени группы
                отличить их друг от друга нельзя ни диктору, ни тесту.
              */
              <span
                role="group"
                aria-label="Действия с платежами"
                data-testid="payment-actions"
                className="flex shrink-0 items-center gap-1.5"
              >
                {/*
                  Возврат — ОТДЕЛЬНЫЙ вход (решение Q33): плановая таблица видов
                  не знает, запланировать возврат нельзя. Это тот же компонент
                  формы с закреплённым видом записи, а не вторая форма.
                */}
                <Button
                  type="button"
                  variant="outline"
                  className="gap-1.5"
                  onClick={() =>
                    openForm({
                      editingPlan: null,
                      editingPayment: null,
                      markPaidPlan: null,
                      fixedKind: "refund",
                    })
                  }
                >
                  <RotateCcw className="size-3.5" />
                  Внести возврат
                </Button>

                {/*
                  ОДИН вход в заведение платежа. Внутри — выбор «Аванс» или
                  «Оплата», и оба варианта кладут в график ОБЯЗАТЕЛЬСТВО: оплата
                  отмечается кнопкой на самой карточке, а не этим диалогом. Так
                  у платежа одно состояние и один способ его сменить.
                */}
                <Button
                  type="button"
                  variant="outline"
                  className="gap-1.5"
                  onClick={() =>
                    openForm({
                      editingPlan: null,
                      editingPayment: null,
                      markPaidPlan: null,
                      fixedKind: "payment",
                    })
                  }
                >
                  <Plus className="size-3.5" />
                  Внести оплату
                </Button>
              </span>
            )}
          </div>

          {rows.length === 0 && (
            <div className="flex flex-col items-center gap-1.5 rounded-xl border-2 border-dashed border-border-muted px-4 py-6 text-center">
              <Receipt className="size-5 text-fg-dim" aria-hidden="true" />
              <p className="text-[13.5px] font-medium text-fg">
                Платежей пока нет
              </p>
              <p className="max-w-xs text-[12.5px] text-fg-muted">
                Запланируйте платёж по счёту поставщика или внесите оплату, если
                деньги уже ушли.
              </p>
            </div>
          )}

          {rows.map((row) => {
            /*
              Занятость строки: у факта операции адресуются факту, у
              неоплаченного плана — плану. Ключ берётся по той же записи, которой
              адресуется действие, иначе кнопка неоплаченной строки не выключилась
              бы, пока идёт операция.
            */
            const rowBusy =
              busyHere?.rowId === (row.payment?.id ?? row.plan?.id)
                ? busyHere
                : null;
            const rowError =
              actionErrorHere?.rowId === (row.payment?.id ?? null)
                ? actionErrorHere.message
                : null;
            const editablePayment =
              row.payment !== null &&
              canMutatePayment({
                role,
                userId: currentUserId,
                createdBy: row.payment.authorId,
              });
            const isPaid = row.payment !== null;
            const title = rowTitle(row);
            const due = row.plan?.dueDate ?? null;

            return (
              <div
                key={row.key}
                /*
                  `data-*` — точка опоры для тестов и для стилей: строка это
                  `div` без роли, а состояние («оплачено») выражается и
                  маркером, и рамкой. Искать их по классу значило бы привязать
                  тест к оформлению.

                  Зелёная рамка — УКРАШЕНИЕ поверх маркера (ADR 0006): цвет не
                  должен быть единственным носителем смысла, и подпись «Оплачено»
                  стоит в строке рядом с ней.
                */
                data-payment-row={row.payment ? "paid" : "planned"}
                data-testid="payment-row"
                className={cn(
                  "flex flex-col gap-1 rounded-xl border px-3 py-2.5",
                  isPaid ? "border-border-accent" : "border-border-muted",
                )}
              >
                <div className="flex items-start gap-3">
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <div className="flex min-w-0 flex-wrap items-baseline gap-2">
                      <RowMarker
                        state={isPaid ? "paid" : "planned"}
                        kind={row.payment?.kind}
                      />
                      <span
                        className={cn(
                          "shrink-0 font-mono text-[13.5px] tabular-nums",
                          row.payment?.kind === "refund"
                            ? "text-fg-red"
                            : "text-fg",
                        )}
                      >
                        {row.payment?.kind === "refund" ? "−" : ""}
                        {fmtRub(row.payment?.amount ?? row.plan?.amount ?? 0)}
                      </span>
                      {title && (
                        <span className="min-w-0 truncate text-[12.5px] text-fg-secondary">
                          {title}
                        </span>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-fg-muted">
                      {isPaid && row.payment ? (
                        <span className="font-mono">
                          {fmtDate(row.payment.paidAt)}
                        </span>
                      ) : (
                        <span className="font-mono">
                          {due ? `до ${fmtDate(due)}` : "срок не задан"}
                        </span>
                      )}
                      {row.payment?.comment && (
                        <span className="min-w-0">{row.payment.comment}</span>
                      )}
                      {!isPaid && row.plan?.condition && (
                        <span className="min-w-0">{row.plan.condition}</span>
                      )}
                    </div>

                    {isPaid && row.payment?.authorName && (
                      <span className="text-[11.5px] text-fg-dim">
                        {row.payment.authorName}
                      </span>
                    )}

                    {/*
                      След отмены: обязательство снова открыто, но отмена не
                      исчезает молча (решение Q29). Дата — дата ПРОВОДКИ, а не
                      отмены: она называет, какое обязательство снова открыто.
                    */}
                    {row.cancelledPayment && (
                      <span className="text-[11.5px] text-fg-red">
                        Оплата от {fmtDate(row.cancelledPayment.paidAt)}{" "}
                        отменена — обязательство снова не закрыто
                      </span>
                    )}

                    {rowError && (
                      <span role="alert" className="text-[12px] text-fg-red">
                        {rowError}
                      </span>
                    )}
                  </div>

                  {canWrite && (
                    <div className="flex shrink-0 items-center gap-0.5">
                      {/*
                        Неоплаченная строка графика: изменить план или отметить
                        его оплаченным. Отметка — единственный способ превратить
                        обязательство в факт, и сумма при этом переносится как
                        есть (ADR 0006).
                      */}
                      {!isPaid && row.plan && (
                        <>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-6 gap-1 rounded-full px-2 text-[11.5px]"
                            aria-label={`Отметить «${row.plan.title}» оплаченным`}
                            disabled={rowBusy !== null}
                            onClick={() =>
                              openForm({
                                editingPlan: null,
                                editingPayment: null,
                                markPaidPlan: row.plan,
                                fixedKind: "payment",
                              })
                            }
                          >
                            <Check className="size-3" />
                            Оплачено
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label={`Изменить «${row.plan.title}»`}
                            title="Изменить"
                            disabled={rowBusy !== null}
                            onClick={() =>
                              openForm({
                                editingPlan: row.plan,
                                editingPayment: null,
                                markPaidPlan: null,
                                fixedKind: "payment",
                              })
                            }
                          >
                            <Pencil className="size-3.5" />
                          </Button>
                        </>
                      )}

                      {isPaid && editablePayment && (
                        <>
                          {/*
                            Правка строки графика у ОПЛАЧЕННОЙ строки — отдельной
                            кнопкой, потому что это другая запись хранилища:
                            «Изменить» у факта правит сумму и дату проводки, а
                            здесь правится обязательство — его название, срок и
                            условие. Пока обе правки были одной кнопкой, после
                            оплаты строку графика становилось нечем исправить.
                          */}
                          {row.plan && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              aria-label={`Изменить «${row.plan.title}»`}
                              title="Изменить платёж в графике"
                              disabled={rowBusy !== null}
                              onClick={() =>
                                openForm({
                                  editingPlan: row.plan,
                                  editingPayment: null,
                                  markPaidPlan: null,
                                  fixedKind: "payment",
                                })
                              }
                            >
                              <CalendarClock className="size-3.5" />
                            </Button>
                          )}
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label={`Изменить оплату от ${fmtDate(row.payment!.paidAt)}`}
                            title="Изменить"
                            disabled={rowBusy !== null}
                            onClick={() =>
                              openForm({
                                editingPlan: null,
                                editingPayment: row.payment,
                                markPaidPlan: null,
                                fixedKind: "payment",
                              })
                            }
                          >
                            <Pencil className="size-3.5" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label={`Отменить оплату от ${fmtDate(row.payment!.paidAt)}`}
                            title="Отменить"
                            className="hover:bg-bg-red-light hover:text-fg-red"
                            disabled={rowBusy !== null}
                            onClick={() => setPendingCancelId(row.payment!.id)}
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
                  Документы строки — ТЕМ ЖЕ компонентом, что во вкладке «Файлы»,
                  но компактным вариантом: чипсы видов, приглашение и шаг выбора
                  вида. Один список, две точки входа, одно правило загрузки —
                  отличается ровно выборка и то, КУДА уходит файл: у факта это
                  `payment_id`, у неоплаченного плана — `payment_plan_id`.

                  Строка остаётся точкой прикрепления: иначе счёт к плановому
                  платежу нельзя было бы создать перетаскиванием ниоткуда.
                  Показывается и наблюдателю: чтение файлов правами не
                  описывается, а документ к оплате — часть суммы, которую
                  наблюдатель видит.
                */}
                <div className="border-t border-border-muted pt-1.5">
                  <DocumentList
                    orgSlug={orgSlug}
                    specItemId={specItemId}
                    files={documentsFor(row)}
                    loading={false}
                    thumbs={NO_THUMBS}
                    onThumbFailed={ignoreThumbFailure}
                    paymentId={row.payment?.id ?? null}
                    paymentPlanId={row.plan?.id ?? null}
                    link={row.payment ? "payment" : "plan"}
                    canWrite={canWrite}
                    variant="chips"
                    onUploaded={(entry) => applyFile({ type: "uploaded", entry })}
                    onChanged={(entry) => applyFile({ type: "changed", entry })}
                    onDeleted={(fileId) => applyFile({ type: "deleted", fileId })}
                    // Оптимистичные правки чипсу не нужны: он инертен, а удаление
                    // и смена вида живут во вкладке «Файлы».
                    mutate={async (_optimistic, run) => run()}
                    title={null}
                  />
                </div>
              </div>
            );
          })}
        </>
      )}

      {/*
        Форма одна на все входы: заведение платежа, отметка «Оплачено», возврат и
        правка. `key` даёт чистый старт каждому открытию — приём тот же, что у
        диалога загрузки файла.
      */}
      <PaymentForm
        key={`${specItemId}:${formVersion}`}
        open={form !== null}
        payment={
          form?.editingPayment
            ? {
                id: form.editingPayment.id,
                kind: form.editingPayment.kind,
                amount: form.editingPayment.amount,
                paidAt: form.editingPayment.paidAt,
                paymentPlanId: form.editingPayment.paymentPlanId,
                comment: form.editingPayment.comment,
              }
            : null
        }
        plan={form?.editingPlan ?? form?.markPaidPlan ?? null}
        markPaid={form?.markPaidPlan !== null && form?.markPaidPlan !== undefined}
        /*
          Вид записи закреплён ВСЕГДА: его называет вход — «Внести оплату» и
          «Внести возврат» (решение Q33: возврат вносится своим входом, а не
          выбором в форме). А «Аванс / Оплата» — не вид записи, а название
          карточки, и спрашивает его сама форма: наверх уходит готовое название.
        */
        fixedKind={form?.editingPayment?.kind ?? form?.fixedKind ?? "payment"}
        /*
          Стоимость позиции и остаток — справки в диалоге: по ним выбирают долю
          и подставляют остаток в сумму. Остаток считается от стоимости и только
          по фактам (ADR 0003), поэтому в отметке «Оплачено» он не предлагается —
          сумма там переносится из платежа как есть.
        */
        itemCost={itemCost}
        remaining={progress.remaining}
        attached={attachedForForm}
        deletable={canWrite}
        onClose={() => setForm(null)}
        onDeleteAttachment={deleteAttachment}
        onSubmit={submitForm}
      />

      {/*
        Подтверждение отмены оплаты — один диалог на вкладку, а не свой у каждой
        строки. Текст отличается для плановой строки: отмена возвращает её в
        «Не оплачено», и пользователь обязан это видеть до нажатия, а не после.
      */}
      <AlertDialog
        open={pendingCancelId !== null}
        onOpenChange={(next) => !next && setPendingCancelId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Отменить оплату?</AlertDialogTitle>
            <AlertDialogDescription>
              {cancelTarget
                ? `${fmtRub(cancelTarget.amount)} от ${fmtDate(cancelTarget.paidAt)} перестанут считаться в суммах.`
                : "Запись перестанет считаться в суммах."}
              {cancelPlanTitle
                ? ` Строка «${cancelPlanTitle}» вернётся в «Не оплачено», а в списке останется пометка об отмене.`
                : " Запись останется в истории позиции."}
              {cancelTarget &&
                isForeignPayment({
                  userId: currentUserId,
                  createdBy: cancelTarget.authorId,
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
