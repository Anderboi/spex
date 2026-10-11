"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { Loader2, Paperclip, Trash2 } from "lucide-react";

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
import { cn, fmtDate, fmtRub } from "@/lib/utils";
import { PAYMENT_LIMITS, PAYMENT_PLAN_LIMITS } from "@/lib/validations";
import { todayIso } from "@/lib/spec/payment-date";
import { roundMoney } from "@/lib/spec/payment-schedule";
import {
  MAX_SPEC_ITEM_FILE_BYTES,
  MAX_SPEC_ITEM_FILE_LABEL,
  guessSpecItemFileCategory,
  type SpecItemFileCategory,
} from "@/lib/spec/file-content";
import { FILE_CATEGORY_OPTIONS } from "@/lib/spec/file-view";
import type { SpecItemFileEntry } from "@/lib/spec/spec-item-files";
import type { PaymentPlanEntry } from "@/lib/spec/payment-plan-types";
import {
  PAYMENT_KIND_ACTION_LABEL,
  PAYMENT_KIND_LABEL,
  type PaymentRecordKind,
} from "@/lib/spec/payment-types";
import type {
  PaymentFormUpload,
  PaymentFormValues,
  PaymentPlanFormValues,
} from "@/lib/spec/payment-form-types";

/**
 * Форма записи о деньгах: ОДНА на план, оплату, возврат и правку любой из них.
 *
 * ── Почему форма одна ──────────────────────────────────────────────────────
 *
 * Плановый платёж и факт — разные строки хранилища (ADR 0006), но вводит их один
 * человек в одном месте. Две формы дали бы две секции прикрепления документов и
 * два выбора роли документа к оплате — то есть два места, где спрашивается одно
 * и то же, и они разошлись бы. Поэтому переключатель «Запланировано / Оплачено
 * сейчас» живёт ЗДЕСЬ, а не в списке: форма знает, какие поля нужны выбранному
 * виду записи, и какие данные уйдут наверх.
 *
 * ── Что решает форма, а что родитель ───────────────────────────────────────
 *
 * Форма решает, ЧТО ввёл пользователь (план или факт) и в каком виде это уходит
 * наверх — двумя разными наборами значений (`PlanFormValues` /
 * `PaymentFormValues`). Родитель решает, каким действием это записать, каким
 * ключом идемпотентности и с какой привязкой к строке графика.
 *
 * ── Вид записи при возврате ────────────────────────────────────────────────
 *
 * `fixedKind` закрепляет вид: «Внести возврат» открывает ТУ ЖЕ форму с
 * зафиксированным «возвратом» (решение Q33 — плановая таблица видов не знает,
 * запланировать возврат нельзя). Второй формы для этого не заводится, а селект
 * вида не показывается там, где выбирать нечего.
 *
 * ── Почему дата оплаты по умолчанию — срок плана ───────────────────────────
 *
 * Отметка «Оплачено» у строки графика: ADR 0006 требует взять дату из срока
 * плана, если он задан, иначе сегодня. Срок — то, к какому дню деньги обещаны, и
 * в большинстве случаев платят именно в него; дата остаётся правимой, потому что
 * «оплатили в другой день» — обычное дело.
 *
 * ── Документы: приложение и удаление ───────────────────────────────────────
 *
 * Файлы, выбранные в форме, НЕ отправляются отсюда: их отправляет родитель —
 * ПОСЛЕ того, как оплата или строка графика записана и известен её
 * идентификатор. Иначе документ пришлось бы привязывать к записи, которой ещё
 * нет. Роль документа спрашивается у каждого файла отдельно (ADR 0005: счёт —
 * основание, чек — подтверждение), поэтому вид стоит в строке файла, а не одним
 * вопросом на всю пачку.
 *
 * Уже приложенные документы здесь только ПОКАЗЫВАЮТСЯ и удаляются: переименование
 * и смена роли остаются во вкладке «Файлы» (решение тикета) — там документ и
 * живёт, а форма оплаты не должна становиться вторым редактором файлов.
 *
 * ── Что проверяет клиент, а что сервер ─────────────────────────────────────
 *
 * Клиент проверяет только очевидное: сумма — положительное число, длины в
 * пределах лимитов, размер файла. Права, принадлежность позиции, вид записи и
 * запись в БД — сервер, и его текст отказа показывается как есть: второй,
 * расходящейся валидации здесь нет (то же правило, что у формы графика).
 */

/** Вид записи, которую вводит форма. */
export type PaymentFormMode = "planned" | "paid";

/**
 * Значения форм приходят из одного словаря (`lib/spec/payment-form-types`):
 * вкладка принимает обе формы одними и теми же действиями, и второй набор типов
 * разошёлся бы с первым молча.
 */
export type {
  PaymentFormUpload,
  PaymentFormValues,
  PaymentPlanFormValues,
};

/** Прикрепляемый документ описан в общем словаре форм (`payment-form-types`). */

/**
 * Итог сохранения: отказ или предупреждение.
 *
 * Два поля, а не одно, потому что это РАЗНЫЕ исходы. Отказ означает, что записи
 * нет: форма остаётся открытой, а пользователь исправляет и повторяет.
 * Предупреждение означает, что запись ЕСТЬ, а документы к ней не приложились
 * (решение тикета: отказ загрузки после создания оплаты не отменяет оплату).
 * Показать предупреждение как отказ значило бы предложить повторить запись,
 * которой уже существует.
 */
export type PaymentFormResult = {
  error?: string | null;
  warning?: string | null;
};

/**
 * Что за платёж заводит человек: аванс или оплату по факту поставки.
 *
 * ── Почему это НЕ вид записи ───────────────────────────────────────────────
 *
 * «Аванс — не вид записи» (решения Q10, Q11): отдельного признака у него нет, он
 * отличается суммой и сроком, а не природой обязательства. Поэтому выбор не
 * заводит ни поля в схеме, ни ветки в ядре — он называет КАРТОЧКУ, то есть
 * ложится в её название: «Аванс» или «Оплата». Отношение оплаченного к стоимости,
 * по которому аванс и виден, считается и без признака.
 *
 * ── Почему выбор есть только у новой карточки ──────────────────────────────
 *
 * У заведённой карточки название уже записано — правится оно там же, где и всё
 * остальное в строке («Изменить»). Второй способ назвать то же самое дал бы две
 * правды об одном поле.
 */
export type PaymentOperation = "advance" | "payment";

/** Подписи выбора: они же — названия карточек. */
export const PAYMENT_OPERATION_LABEL: Record<PaymentOperation, string> = {
  advance: "Аванс",
  payment: "Оплата",
};

/** Показывать ли выбор роли документа: счёт — основание, чек — подтверждение. */
const PAYMENT_ROLE_CATEGORIES: readonly SpecItemFileCategory[] = [
  "invoice",
  "receipt",
];

/**
 * Роль документа по умолчанию для принятого файла.
 *
 * ── Почему догадка сервера здесь не годится ────────────────────────────────
 *
 * `guessSpecItemFileCategory` на общем пути загрузки отвечает на вопрос «что это
 * за файл» — и для PDF отвечает «документ». У документа к оплате роль несут
 * только счёт и чек (ADR 0005), поэтому догадка дала бы значение, которого в
 * списке ролей НЕТ: селект показался бы пустым, а нетронутый уходил бы на сервер
 * как «документ» — то есть роль терялась бы молча, ровно то, от чего ADR 0005 и
 * защищает.
 *
 * Поэтому по умолчанию называется САМАЯ ВЕРОЯТНАЯ роль, и это подтверждение:
 * чек и платёжное поручение прикладывают в момент оплаты чаще, чем основание, —
 * основание приходит раньше, до денег, и его кладут к плановой строке. Догадка по
 * формату при этом не выбрасывается: она подсказывает, когда попадает в список
 * ролей.
 */
function defaultPaymentRole(file: File): SpecItemFileCategory {
  const guessed = guessSpecItemFileCategory({
    mimeType: file.type,
    fileName: file.name,
  });

  return PAYMENT_ROLE_CATEGORIES.includes(guessed) ? guessed : "receipt";
}

/** Имя файла для подписи строки очереди: пустое имя показывается прочерком. */
function displayName(file: File): string {
  return file.name.trim().length > 0 ? file.name : "файл без имени";
}

/**
 * Готовые доли стоимости: самые частые случаи ввода (аванс, половина,
 * полностью). Своё число вводится в поле процента рядом.
 */
const PERCENT_PRESETS = [25, 50, 100] as const;

/**
 * Подпись кнопки сохранения по тому, что записывается.
 *
 * Три исхода, и каждый называет своё действие: завести карточку в графике,
 * превратить обязательство в факт или внести проводку.
 */
function submitLabel(args: {
  editing: boolean;
  creatingCard: boolean;
  markedPaid: boolean;
  kind: PaymentRecordKind;
}): string {
  if (args.editing) return "Сохранить";
  if (args.creatingCard) return "Добавить в график";
  // Отметка у карточки отмечает ОБЯЗАТЕЛЬСТВО оплаченным, а не вносит отдельную
  // оплату: кнопка называет то, что произойдёт.
  if (args.markedPaid) return "Отметить оплаченным";
  return PAYMENT_KIND_ACTION_LABEL[args.kind];
}

export default function PaymentForm({
  open,
  payment = null,
  plan = null,
  markPaid = false,
  fixedKind = null,
  itemCost = 0,
  remaining = 0,
  attached = [],
  deletable = false,
  onClose,
  onDeleteAttachment,
  onSubmit,
}: {
  open: boolean;
  /** Редактируемый ФАКТ; `null` — создание. */
  payment?: PaymentEntryLike | null;
  /** Редактируемая КАРТОЧКА графика; `null` — создание. */
  plan?: PaymentPlanEntry | null;
  /**
   * Отметка «Оплачено» на карточке: форма открыта, чтобы СОЗДАТЬ факт по
   * известному обязательству, а не править карточку.
   *
   * Отдельный признак, а не вывод из наличия плана: одна и та же карточка
   * открывается и «изменить», и «оплатить», и различить эти входы по её полям
   * нельзя. Задаёт его родитель — он и есть тот, кто знает, какую кнопку нажали.
   */
  markPaid?: boolean;
  /**
   * Закреплённый вид записи: селект вида не показывается, а наверх уходит это
   * значение. Так открывается «Внести возврат».
   */
  fixedKind?: PaymentRecordKind | null;
  /**
   * Полная стоимость позиции. Показывается справкой, а не полем: сумма платежа —
   * самостоятельные данные, но выбирающему долю нужно видеть, от чего она.
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
  /** Уже приложенные документы: показываются и (по праву) удаляются. */
  attached?: SpecItemFileEntry[];
  /** Право удалять приложенные документы: наблюдателю кнопки нет. */
  deletable?: boolean;
  /** Закрыть без сохранения: отмена, крестик, успех. */
  onClose: () => void;
  /** Удалить приложенный документ. Возвращает текст отказа или `null`. */
  onDeleteAttachment?: (file: SpecItemFileEntry) => Promise<string | null>;
  /**
   * Сохранить. Отказ показывается здесь, а закрывает форму родитель — он же
   * обновляет список записанной строкой и прикладывает выбранные документы.
   */
  onSubmit: (input: {
    payment: PaymentFormValues | null;
    plan: PaymentPlanFormValues | null;
    uploads: PaymentFormUpload[];
  }) => Promise<PaymentFormResult>;
}) {
  /**
   * Открыта ли форма НА ПРАВКЕ существующей записи.
   *
   * Правка не даёт сменить ни вид записи, ни то, карточка это или факт: «оплата»
   * и «возврат» — разные проводки, а карточка и факт — разные строки хранилища.
   * Форма не подменяет это правило догадкой.
   */
  const editing = payment !== null || plan !== null;
  /**
   * Правится КАРТОЧКА графика: она пришла пропсом, и её НЕ отмечают оплаченной.
   * У неё свой набор полей, свой заголовок и кнопка «Сохранить».
   */
  const editingPlan = plan !== null && payment === null && !markPaid;
  /** Правится ФАКТ: заголовок называет вид записи, а не «оплату» по умолчанию. */
  const editingPayment = payment !== null;
  /**
   * Заводим НОВУЮ КАРТОЧКУ графика.
   *
   * Четыре входа в одну форму, и путь у каждого свой: завести карточку
   * («Внести оплату»), отметить её оплаченной (`markPaid`), внести возврат
   * (`fixedKind`) и изменить любую из записей. Заведение карточки — единственный,
   * где спрашивается «аванс или оплата»: у остальных запись уже названа.
   */
  const creatingCard = !editing && plan === null && fixedKind !== "refund";

  /**
   * Вид записи: у новой — из `fixedKind` или «оплата», у правки — вид записи.
   *
   * Селект показывается только там, где выбирать есть что: у возврата вид
   * закреплён, у карточки вида нет вовсе (плановая таблица знает только «мы
   * должны»).
   */
  const [kind, setKind] = useState<PaymentRecordKind>(
    fixedKind ?? payment?.kind ?? "payment",
  );

  /**
   * Сумма НЕ правится там, где она переносится.
   *
   * Отметка «Оплачено» превращает обязательство в факт, и ADR 0006 прямо
   * называет, как: «сумма переносится как есть». Свободное поле позволяло бы
   * переписать её, и тогда «та же сумма» перестало бы быть свойством отметки, а
   * стало бы обещанием формы.
   *
   * У правки факта по карточке запрет тот же и по той же причине. Сумму
   * записанной оплаты правят у факта ВНЕ графика — там она самостоятельные
   * данные, а не перенесённое обязательство.
   */
  const amountFixed = plan !== null;

  /** Сумма — строкой: «12 000,5» и «12000.5» должны вводиться одинаково свободно. */
  const [amount, setAmount] = useState(
    plan ? String(plan.amount) : payment ? String(payment.amount) : "",
  );
  /**
   * Что за платёж заводим: «Аванс» или «Оплата».
   *
   * Состояние ФОРМЫ, а не родителя: выбор — часть ввода, как и название, и
   * родителю он не нужен вовсе — наверх уходит уже готовое название карточки
   * (`resolvedTitle`). Держи его родитель, между выбором и записью появилось бы
   * третье состояние, которое надо синхронизировать.
   */
  const [operation, setOperation] = useState<PaymentOperation>("payment");
  /**
   * Название, которое человек написал сам. `null` — не писал, и карточка
   * называется выбранной операцией.
   *
   * Два поля вместо одного синхронизируемого: набранное «Поставка вторая» не
   * должно затираться сменой выбора, а невыбранное — не должно оставаться
   * пустым. Синхронизация потребовала бы эффекта, то есть лишнего кадра и
   * расхождения между тем, что на экране, и тем, что в состоянии.
   */
  const [titleOverride, setTitleOverride] = useState<string | null>(
    plan ? plan.title : null,
  );
  /** Название карточки: написанное человеком или подставленное выбором. */
  const resolvedTitle = titleOverride ?? PAYMENT_OPERATION_LABEL[operation];

  const [condition, setCondition] = useState(plan?.condition ?? "");
  /**
   * Срок — данные карточки. У отметки «Оплачено» он показывается справкой, потому
   * что уже записан в карточке, и подменять его датой оплаты нельзя.
   */
  const [dueDate, setDueDate] = useState(plan?.dueDate ?? "");
  /**
   * Дата оплаты. По умолчанию — срок карточки, иначе сегодня (ADR 0006): в
   * большинстве случаев платят в срок, а «оплатили в другой день» правится
   * руками. Считает её общий модуль (`lib/spec/payment-date`): иначе форма и
   * запись в БД расходились бы на границе суток и в разных часовых поясах.
   */
  const [paidAt, setPaidAt] = useState(
    payment?.paidAt ?? (plan?.dueDate || todayIso()),
  );
  /**
   * Привязка факта — АВТОМАТИЧЕСКАЯ, и поля выбора здесь нет.
   *
   * Факт в этой модели всегда возникает ИЗ обязательства: его создаёт отметка
   * «Оплачено» на карточке. Выбор «без плана» предлагал бы путь, которого в
   * интерфейсе нет, — а оплата вне графика, пришедшая из данных, сохраняет свою
   * привязку при правке (её видно в записи, а не в поле формы).
   */
  const paymentPlanId = payment?.paymentPlanId ?? plan?.id ?? null;
  const [comment, setComment] = useState(payment?.comment ?? "");

  /** Выбранные, но ещё не отправленные документы. */
  const [uploads, setUploads] = useState<
    { key: string; file: File; category: SpecItemFileCategory }[]
  >([]);
  /** Уже приложенные документы, которые пользователь удалил в этой форме. */
  const [removed, setRemoved] = useState<string[]>([]);
  /** Идёт удаление приложенного документа: кнопки выключены. */
  const [removing, setRemoving] = useState<string | null>(null);

  const [clientError, setClientError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  /**
   * Процент от стоимости — только способ ввода суммы.
   *
   * Хранится в состоянии формы и НЕ уходит на сервер: в БД ложится посчитанная
   * сумма. Двух правд — суммы и процента — не заводится: при смене стоимости они
   * разошлись бы, и никто не сказал бы, какая верна. Так же относится к делу и
   * остаток по позиции: подставленное число уходит суммой, а не ссылкой на неё.
   */
  const [percent, setPercent] = useState("");

  /**
   * Процент и остаток предлагаются, только когда есть от чего считать и когда
   * сумма — свободный ввод.
   *
   * У отметки «Оплачено» сумма переносится из обязательства как есть (ADR 0006),
   * и подставлять туда процент от стоимости или остаток по позиции значило бы
   * записать другую сумму под видом той же самой. У правки запрет тот же: процент
   * подменил бы уже записанное число.
   */
  const percentAvailable = !amountFixed && itemCost > 0;
  /**
   * Остаток по позиции — справка, и показывается даже там, где подставить его
   * нельзя: у отметки «Оплачено» он говорит, какую долю составляет переносимая
   * сумма. Кнопка же подстановки есть только у свободного ввода — иначе она
   * подменила бы перенесённую или уже записанную сумму целиком.
   */
  const hasRemaining = remaining > 0;
  const canApplyRemaining = hasRemaining && !amountFixed && payment === null;

  /** Скрытый `<input type="file">`: открывается кнопкой «Приложить документы». */
  const pickerRef = useRef<HTMLInputElement>(null);

  const visibleAttached = useMemo(
    () => attached.filter((file) => !removed.includes(file.id)),
    [attached, removed],
  );

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

  /**
   * Приём файлов.
   *
   * Роль каждого файла предзаполняется по списку РОЛЕЙ, а не догадкой формата —
   * см. `defaultPaymentRole`. Роль здесь ВИДНО и можно перебить: у документа к
   * оплате вид несёт роль (ADR 0005), а формат её не различает.
   */
  const acceptFiles = useCallback(
    (picked: File[]) => {
      if (picked.length === 0) return;

      const tooBig = picked.find((file) => file.size > MAX_SPEC_ITEM_FILE_BYTES);
      if (tooBig) {
        setClientError(
          `Файл «${tooBig.name}» больше ${MAX_SPEC_ITEM_FILE_LABEL} и не был выбран.`,
        );
        return;
      }

      setClientError(null);
      setUploads((current) => [
        ...current,
        ...picked.map((file, index) => ({
          key: `${Date.now()}-${index}-${file.name}`,
          file,
          category: defaultPaymentRole(file),
        })),
      ]);
    },
    [],
  );

  const removeUpload = useCallback((key: string) => {
    setUploads((current) => current.filter((row) => row.key !== key));
  }, []);

  /**
   * Удаление приложенного документа.
   *
   * Мимо `uploads` — документ уже лежит в БД, и удаляет его отдельный запрос.
   * Строка исчезает только после успеха: показать её удалённой, а потом вернуть
   * значило бы показать удаление, которого не было.
   */
  const removeAttached = useCallback(
    async (file: SpecItemFileEntry) => {
      if (!onDeleteAttachment || removing) return;
      setRemoving(file.id);
      setClientError(null);
      setServerError(null);

      try {
        const error = await onDeleteAttachment(file);
        if (error) {
          setServerError(error);
          return;
        }
        setRemoved((current) => [...current, file.id]);
      } finally {
        setRemoving(null);
      }
    },
    [onDeleteAttachment, removing],
  );

  const submit = useCallback(async () => {
    setServerError(null);
    setWarning(null);

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

    /** Карточка и факт ограничены по-разному: у карточки предел свой. */
    const amountMax = creatingCard
      ? PAYMENT_PLAN_LIMITS.amountMax
      : PAYMENT_LIMITS.amountMax;
    if (parsedAmount > amountMax) {
      setClientError("Слишком большая сумма");
      return;
    }

    const trimmedComment = comment.trim();
    if (trimmedComment.length > PAYMENT_LIMITS.commentMax) {
      setClientError("Комментарий слишком длинный");
      return;
    }

    const trimmedTitle = resolvedTitle.trim();
    if (creatingCard || editingPlan) {
      if (trimmedTitle.length === 0) {
        setClientError("Укажите название платежа");
        return;
      }
      if (trimmedTitle.length > PAYMENT_PLAN_LIMITS.titleMax) {
        setClientError("Название слишком длинное");
        return;
      }
    }

    const trimmedCondition = condition.trim();
    if (trimmedCondition.length > PAYMENT_PLAN_LIMITS.conditionMax) {
      setClientError("Условие оплаты слишком длинное");
      return;
    }

    setClientError(null);
    setSaving(true);

    try {
      const result = await onSubmit({
        /*
          Карточка графика — то, что заводит «Внести оплату» и правит «Изменить»
          у карточки. Факт — то, что создаёт отметка «Оплачено» и что вносит
          «Внести возврат»; у него привязка к обязательству уже известна.
        */
        plan:
          creatingCard || editingPlan
            ? {
                title: trimmedTitle,
                amount: parsedAmount,
                condition:
                  trimmedCondition.length > 0 ? trimmedCondition : null,
                // Пустое значение — это «не задано», а не пустая строка: в БД у
                // этого состояния одно представление.
                dueDate: dueDate.length > 0 ? dueDate : null,
              }
            : null,
        payment:
          creatingCard || editingPlan
            ? null
            : {
                kind,
                amount: parsedAmount,
                // Пустая дата — «сегодня»: сервер подставляет тот же день, что и
                // `paid_at default current_date`.
                paidAt: paidAt.length > 0 ? paidAt : null,
                paymentPlanId,
                comment: trimmedComment.length > 0 ? trimmedComment : null,
              },
        uploads: uploads.map((row) => ({
          file: row.file,
          category: row.category,
        })),
      });

      if (result.error) setServerError(result.error);
      if (result.warning) setWarning(result.warning);
    } finally {
      setSaving(false);
    }
  }, [
    amount,
    comment,
    condition,
    creatingCard,
    dueDate,
    editingPlan,
    kind,
    onSubmit,
    paidAt,
    paymentPlanId,
    resolvedTitle,
    uploads,
  ]);

  const error = clientError ?? serverError;
  const planning = creatingCard || editingPlan;

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
            {editingPayment
              ? PAYMENT_KIND_LABEL[kind]
              : editingPlan
                ? "Платёж в графике"
                : creatingCard
                  ? "Внести оплату"
                  : plan
                    ? "Отметить оплаченным"
                    : `Новая запись · ${PAYMENT_KIND_LABEL[kind].toLowerCase()}`}
          </DialogTitle>
          <DialogDescription className="text-[13px] text-fg-secondary">
            {editingPlan
              ? "Измените сумму, условие оплаты или срок."
              : creatingCard
                ? "Платёж встанет в график обязательством: оплаченным его отметит кнопка на карточке."
                : payment
                  ? "Измените сумму, дату или комментарий."
                  : plan
                    ? "Сумма переносится из платежа как есть: отметка «Оплачено» превращает обязательство в факт."
                    : "Сумма и дата — самостоятельные данные: из стоимости позиции они не выводятся."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          {/*
            «Аванс» или «Оплата» — выбор у НОВОЙ карточки, и он называет её, а не
            вид записи: отдельного признака аванса не заводится (решения Q10,
            Q11), он отличается суммой и сроком. Оба варианта кладут в график
            обязательство, которое потом отмечают кнопкой «Оплачено» на карточке.
          */}
          {creatingCard && (
            <Field label="Что за платёж">
              <div
                role="group"
                aria-label="Что за платёж"
                className="flex gap-1 rounded-lg bg-bg-select p-1"
              >
                {(["advance", "payment"] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={operation === value}
                    disabled={saving}
                    onClick={() => setOperation(value)}
                    className={cn(
                      "h-7 flex-1 rounded-md text-[12.5px] transition-colors",
                      operation === value
                        ? "bg-bg-card font-medium text-fg shadow-sm"
                        : "text-fg-muted hover:text-fg",
                    )}
                  >
                    {PAYMENT_OPERATION_LABEL[value]}
                  </button>
                ))}
              </div>
            </Field>
          )}

          {/*
            Вид записи — селект, и только у НОВОЙ проводки: у возврата он
            закреплён входом («Внести возврат»), у правки вид не меняется (это
            другая проводка, а не правка), у карточки вида нет вовсе — плановая
            таблица знает только «мы должны» (решение Q33).
          */}
          {!planning && fixedKind === null && payment === null && (
            <Field label="Вид записи">
              <select
                aria-label="Вид записи"
                value={kind}
                onChange={(event) =>
                  setKind(event.target.value as PaymentRecordKind)
                }
                disabled={saving}
                className="h-9 w-full rounded-lg border border-border-muted bg-bg-white px-2 font-sans text-[13.5px] text-fg disabled:cursor-not-allowed disabled:opacity-60"
              >
                {(["payment", "refund"] as const).map((value) => (
                  <option key={value} value={value}>
                    {PAYMENT_KIND_LABEL[value]}
                  </option>
                ))}
              </select>
            </Field>
          )}

          {/*
            Название карточки. У новой оно подставлено выбором «Аванс / Оплата»,
            и человек его правит: «Аванс» — частый случай, а не единственный
            («поставка», «остаток»). У правки приходит из записи.
          */}
          {planning && (
            <Field label="Название">
              <Input
                aria-label="Название"
                value={resolvedTitle}
                onChange={(event) => setTitleOverride(event.target.value)}
                placeholder="Аванс, поставка, остаток"
                disabled={saving}
                autoFocus
              />
            </Field>
          )}

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
                disabled={saving || amountFixed}
                autoFocus={!planning}
              />
              {amountFixed && (
                <span className="mt-1 block text-[11.5px] text-fg-dim">
                  Сумма переносится из платежа в графике как есть
                </span>
              )}
            </Field>

            {planning ? (
              <Field label="Срок оплаты">
                <Input
                  aria-label="Срок оплаты"
                  type="date"
                  value={dueDate}
                  onChange={(event) => setDueDate(event.target.value)}
                  disabled={saving}
                />
              </Field>
            ) : (
              <Field label="Дата оплаты">
                <Input
                  aria-label="Дата оплаты"
                  type="date"
                  value={paidAt}
                  onChange={(event) => setPaidAt(event.target.value)}
                  disabled={saving}
                />
              </Field>
            )}
          </div>

          {/*
            Срок плана — справка, а не поле: он уже записан в строке графика, и
            править его из карточки оплаты значило бы править график из факта.
            Пустая дата подставилась в дату оплаты выше — ADR 0006 требует ровно
            этого порядка.
          */}
          {!planning && plan !== null && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg bg-bg-card2 px-3 py-2">
              <span className="text-[12.5px] text-fg-muted">
                Срок платежа:{" "}
                <span className="font-mono tabular-nums text-fg">
                  {plan.dueDate ? fmtDate(plan.dueDate) : "не задан"}
                </span>
              </span>
            </div>
          )}

          {/*
            Полная стоимость позиции — справка, а не поле.
            
            Сумма платежа самостоятельна (из стоимости не выводится), но выбирать
            её долю, не видя целого, нечем: «25 %» без базы — это число, про
            которое нечего сказать. Поэтому стоимость стоит здесь, рядом с суммой
            и процентом, а не только в шапке вкладки под диалогом.
          */}
          {itemCost > 0 && (
            <div
              data-testid="form-item-cost"
              className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg bg-bg-card2 px-3 py-2"
            >
              <span className="text-[12.5px] text-fg-muted">
                Стоимость позиции
              </span>
              <span className="font-mono text-[13.5px] font-medium tabular-nums text-fg">
                {fmtRub(itemCost)}
              </span>
            </div>
          )}

          {/*
            Процент — способ ВВОДА суммы, а не данные записи: он разово считает
            сумму, и в БД уходит она. Поэтому поле стоит рядом с суммой, а не
            отдельной сущностью, и предлагается только там, где сумма — свободный
            ввод: у отметки «Оплачено» она переносится как есть (ADR 0006).
          */}
          {percentAvailable && (
            <Field label={`Доля от стоимости (${fmtRub(itemCost)})`}>
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
              {canApplyRemaining && (
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
            Условие оплаты — данные карточки: у факта его нет.
          */}
          {planning && (
            <Field label="Условие оплаты">
              <Textarea
                aria-label="Условие оплаты"
                value={condition}
                onChange={(event) => setCondition(event.target.value)}
                placeholder="После подписания договора"
                rows={3}
                disabled={saving}
              />
            </Field>
          )}

          {!planning && (
            <Field label="Комментарий">
              <Textarea
                aria-label="Комментарий"
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                placeholder="Номер счёта, основание, примечание"
                rows={3}
                disabled={saving}
              />
            </Field>
          )}

          {/* ── Документы к оплате ─────────────────────────────────────── */}
          {/*
            Уже приложенные документы: показаны и (по праву) удаляемы. Это третья
            точка входа того же файла, а не копия: строка одна, и удаление здесь
            убирает её отовсюду.
          */}
          {visibleAttached.length > 0 && (
            <div className="flex flex-col gap-1 rounded-lg border border-border-muted px-3 py-2">
              <span className="text-[12px] text-fg-muted">
                Приложенные документы
              </span>
              {visibleAttached.map((file) => (
                <div key={file.id} className="flex items-center gap-2">
                  <Paperclip
                    className="size-3.5 shrink-0 text-fg-dim"
                    aria-hidden="true"
                  />
                  <span
                    className="min-w-0 flex-1 truncate text-[12.5px] text-fg"
                    title={file.fileName}
                  >
                    {file.fileName}
                  </span>
                  {deletable && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Удалить «${file.fileName}»`}
                      title="Удалить"
                      disabled={saving || removing !== null}
                      className="hover:bg-bg-red-light hover:text-fg-red"
                      onClick={() => void removeAttached(file)}
                    >
                      {removing === file.id ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="size-3.5" />
                      )}
                    </Button>
                  )}
                </div>
              ))}
              <span className="text-[11.5px] text-fg-dim">
                Переименование и смена роли — во вкладке «Файлы».
              </span>
            </div>
          )}

          {/*
            Новые документы: выбираются здесь, отправляются родителем ПОСЛЕ
            записи. Роль спрашивается у каждого файла отдельно — у основания и
            подтверждения роли разные, и один ответ на пачку потерял бы одну из
            них (ADR 0005).
          */}
          <div className="flex flex-col gap-1.5 rounded-lg border border-dashed border-border-muted px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[12px] text-fg-muted">
                Счёт — основание, чек — подтверждение
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-6 gap-1 rounded-full border-dashed px-2 text-[11.5px]"
                disabled={saving}
                onClick={() => pickerRef.current?.click()}
              >
                <Paperclip className="size-3" />
                Приложить документ
              </Button>
            </div>

            <input
              ref={pickerRef}
              type="file"
              multiple
              className="hidden"
              aria-label="Выбрать документы к оплате"
              onChange={(event) => {
                const picked = Array.from(event.target.files ?? []);
                // Значение сбрасывается сразу: без этого повторный выбор ТОГО ЖЕ
                // файла не вызовет `change`, и после ошибки выбрать его заново
                // было бы нечем.
                event.target.value = "";
                acceptFiles(picked);
              }}
            />

            {uploads.map((row) => (
              <div key={row.key} className="flex items-center gap-2">
                <span
                  className="min-w-0 flex-1 truncate text-[12.5px] text-fg"
                  title={displayName(row.file)}
                >
                  {displayName(row.file)}
                </span>
                <select
                  aria-label={`Роль документа «${displayName(row.file)}»`}
                  value={row.category}
                  disabled={saving}
                  onChange={(event) =>
                    setUploads((current) =>
                      current.map((item) =>
                        item.key === row.key
                          ? {
                              ...item,
                              category: event.target
                                .value as SpecItemFileCategory,
                            }
                          : item,
                      ),
                    )
                  }
                  className="h-7 shrink-0 rounded-md border border-border-muted bg-bg-white px-1.5 font-sans text-[11.5px] text-fg"
                >
                  {FILE_CATEGORY_OPTIONS.filter((option) =>
                    PAYMENT_ROLE_CATEGORIES.includes(option.value),
                  ).map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Убрать «${displayName(row.file)}»`}
                  title="Убрать"
                  disabled={saving}
                  onClick={() => removeUpload(row.key)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            ))}

            {uploads.length === 0 && (
              <span className="text-[11.5px] text-fg-dim">
                Документ можно приложить и позже — во вкладке «Файлы».
              </span>
            )}
          </div>

          {error && (
            <p role="alert" className="text-[12.5px] text-fg-red">
              {error}
            </p>
          )}

          {/*
            Предупреждение, а не отказ: запись создана, а документы к ней не
            приложились. Второй `role="alert"` здесь не заводится — экранная
            читалка объявила бы два сообщения об одном исходе; `status` сообщает
            «работа закончена, но не целиком».
          */}
          {warning && !error && (
            <p role="status" className="text-[12.5px] text-fg-red">
              {warning}
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
            {/* Запись уже есть — «отмена» закрывает форму, а не отменяет запись. */}
            {warning && !error ? "Закрыть" : "Отмена"}
          </Button>
          <Button
            type="button"
            size="lg"
            onClick={() => void submit()}
            disabled={saving}
          >
            {saving && <Loader2 className="mr-2 size-4 animate-spin" />}
            {submitLabel({
              editing: editingPlan || editingPayment,
              creatingCard,
              // Отметка «Оплачено» — создание факта по известной карточке, а не
              // отдельная оплата: сумма приходит из неё и не переписывается.
              markedPaid: markPaid,
              kind,
            })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Запись факта в объёме, нужном форме.
 *
 * ── Почему не `PaymentEntry` целиком и не `PaymentFormValues` ──────────────
 *
 * `PaymentEntry` шире: форме не нужны ни снимки (код, название позиции, проект),
 * ни автор, ни время записи, и тащить их сюда значило бы требовать от каждой
 * вызывающей стороны полную запись, чтобы открыть форму на правку.
 *
 * `PaymentFormValues` — наоборот: это то, что форма ОТДАЁТ. Совпадают они
 * сегодня полем в поле, и это совпадение проверяется компилятором: вкладка
 * собирает `payment` из полей этой записи, поэтому новое поле в форме немедленно
 * потребует его и здесь. Слив типы в один, мы получили бы «запись, которую можно
 * отправить», — а её нельзя: `id` у правки есть, у создания нет.
 */
export type PaymentEntryLike = {
  id: string;
  kind: PaymentRecordKind;
  amount: number;
  paidAt: string;
  paymentPlanId: string | null;
  comment: string | null;
};
