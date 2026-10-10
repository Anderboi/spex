/**
 * Файлы позиции спецификации: ядро операций без сессии и без Next.
 *
 * ── Почему отдельный модуль ───────────────────────────────────────────────
 *
 * Ровно по той же причине, по которой существуют `./comment-write` и
 * `./history-read`: сессия, `orgSlug` → `orgId`, проверка прав и форма ответа
 * для клиента живут в server action (`actions/spec-item-files.ts`), а проверки
 * принадлежности, построение пути, работа с объектом Storage и запись в БД —
 * здесь, куда клиент БД и клиент Storage приходят аргументами (DI, как в
 * `recordSpecItemEvent`). Так контракт проверяется unit-тестами на подставных
 * клиентах, без Next, без живой БД и без сети.
 *
 * ── Границы доверия ───────────────────────────────────────────────────────
 *
 * От клиента приходят ровно четыре вещи: сам файл, желаемый вид документа,
 * (необязательно) имя файла и (необязательно) оплата, к которой файл
 * прикрепляется. Всё остальное определяет сервер: `orgId` (из сессии),
 * `specItemId` (из аргумента, проверенного по организации), `projectId` (из
 * строки позиции), `storage_path` (собирается здесь), `uploaded_by` (из сессии),
 * `created_at` (серверное время), `id` (БД).
 *
 * `payment_id` — единственное клиентское значение, которое что-то СВЯЗЫВАЕТ, и
 * поэтому оно не принимается на веру: ядро само читает строку оплаты и сверяет
 * её позицию, организацию и проект (`resolvePayment`), а вид записи для подписи
 * берёт из БД, а не из формы. Второй контур — триггер
 * `spec_item_files_payment_scope` (миграция `20261011_001`): он снимает ссылку,
 * если она всё-таки оказалась чужой.
 *
 * `storage_path` НИКОГДА не приходит снаружи: его нет ни в одном входном типе.
 * Для чтения и удаления путь берётся из строки БД, а строка ищется по
 * `id + org_id + spec_item_id`, и путь дополнительно сверяется с ожидаемым
 * префиксом (`isSpecItemFilePathExpected`). Это защита от строки, попавшей в БД
 * в обход кода, и от чужого объекта в принципе.
 *
 * ── Порядок проверок ──────────────────────────────────────────────────────
 *
 * 1. позиция есть в этой организации и не удалена (`NOT_FOUND`);
 * 2. `projectId` совпадает с проектом позиции (`NOT_FOUND`) — тот же ответ, что
 *    и в п.1: по коду отказа нельзя узнать о чужой позиции ничего лишнего;
 * 3. файл есть в этой организации и этой позиции (`NOT_FOUND`);
 * 4. файл не удалён (`NOT_FOUND`) — мягко удалённый файл не должен ни
 *    подписываться, ни правиться, ни удаляться повторно «по-настоящему»;
 * 5. путь объекта ожидаемый (`FAILED`) — сюда попадает только подделка;
 * 6. при загрузке — вид документа и содержимое файла (`INVALID_INPUT`);
 * 7. при загрузке к оплате — оплата есть, жива и принадлежит этой позиции
 *    (`INVALID_INPUT`, один текст на все расхождения). Проверяется ПОСЛЕ
 *    содержимого и ДО Storage: незачем грузить объект, привязать который
 *    всё равно нельзя, и незачем объяснять «оплата не найдена» файлу, который
 *    не прошёл проверку вида.
 *
 * ── Вид документа: догадка вместо вопроса ─────────────────────────────────
 *
 * Если клиент не указал вид, его определяет сервер по ПОДТВЕРЖДЁННОМУ формату
 * (`guessSpecItemFileCategory` в `./file-content`) — PDF становится документом,
 * JPG текстурой, DWG чертежом. Так большинство загрузок не требует лишнего шага
 * «выберите вид», а точный вид ставится потом правкой строки (`updateSpecItemFile`).
 * Явно присланный вид догадку перебивает — но обязан быть из закрытого списка.
 *
 * ── Стратегия рассинхронизации БД и Storage ───────────────────────────────
 *
 * Атомарной операции «запись в БД + запись в Storage» не существует: объект
 * живёт в S3-совместимом хранилище, а не в таблице Postgres, и откатить его
 * вместе с транзакцией нельзя. Поэтому выбрана компенсирующая стратегия, и она
 * зафиксирована здесь:
 *
 *   * ЗАГРУЗКА: сначала объект в Storage, потом INSERT. Если INSERT не удался —
 *     объект немедленно удаляется (`removeQuietly`), то есть orphan не
 *     остаётся. Если удалить объект тоже не удалось, в лог уходит имя пути:
 *     такая пара «объект без строки» невидима приложению (список читает БД) и
 *     подчищается вместе с организацией.
 *     Обратный порядок (INSERT → upload) дал бы строку без объекта, а это хуже:
 *     файл был бы виден в списке и не открывался.
 *
 *   * УДАЛЕНИЕ: сначала мягкое удаление строки (`deleted_at = now()`), потом
 *     best-effort удаление объекта. БД — источник истины: после успешного
 *     soft-delete файл исчезает из списка и перестаёт подписываться, даже если
 *     Storage ответил ошибкой. Ошибка Storage не откатывает БД и не делает
 *     операцию неуспешной — иначе пользователь видел бы ошибку при фактически
 *     скрытом файле, а повторный запрос удалял бы объект, которого уже нет.
 *     Объект-сирота в этом случае остаётся неоплаченным мусором ровно до
 *     удаления организации; глобальная уборка Storage вне рамок этой задачи.
 *
 *   * ПОВТОРНОЕ УДАЛЕНИЕ идемпотентно: строка уже soft-deleted → Storage не
 *     трогаем (объект мог быть удалён первым вызовом), результат тот же
 *     `{ ok: true, deleted: false }`. Это и делает операцию безопасной для
 *     повторного вызова при ретрае.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../types";
import {
  MAX_SPEC_ITEM_FILE_BYTES,
  MAX_SPEC_ITEM_FILE_LABEL,
  checkDeclaredMimeMatchesContent,
  extensionForMime,
  guessSpecItemFileCategory,
  isAllowedSpecItemFileMime,
  isSpecItemFileCategory,
  isSpecItemFilePathExpected,
  normalizeFileName,
  normalizeMimeType,
  buildSpecItemFilePath,
  type SpecItemFileCategory,
} from "./file-content";
import {
  isPaymentKind,
  type PaymentRecordKind,
} from "./payment-types";

/** Клиент БД: как у остальных слоёв, приходит аргументом. */
export type SpecItemFilesDb = SupabaseClient<Database>;

/* ------------------------------------------------------------------ */
/*  Storage: узкий интерфейс вместо целого клиента                     */
/* ------------------------------------------------------------------ */

/** Ошибка Storage у supabase-js: либо объект, либо строка. */
type StorageErrorLike = { message: string } | null;

/**
 * Всё, что ядру нужно от Storage.
 *
 * Узкий интерфейс, а не `SupabaseClient`, по двум причинам: тесты подставляют
 * простой объект без имитации цепочки PostgREST, а ядро не может случайно
 * дотянуться до БД «через Storage-клиент».
 */
export type SpecItemFilesStorage = {
  upload(args: {
    path: string;
    bytes: Uint8Array;
    contentType: string;
  }): Promise<{ error: StorageErrorLike }>;
  remove(path: string): Promise<{ error: StorageErrorLike }>;
  createSignedUrl(args: {
    path: string;
    expiresIn: number;
    /**
     * Имя для `Content-Disposition: attachment`; `true` — «имя подставит
     * Storage», `null`/отсутствие — просмотр в браузере, а не скачивание: это
     * разные действия пользователя, и различает их он сам.
     */
    download?: string | true | null;
  }): Promise<{
    data: { signedUrl: string } | null;
    error: StorageErrorLike;
  }>;
};

/** Время жизни signed URL. Короткое: ссылка выдаётся на один показ/скачивание. */
export const SPEC_ITEM_FILE_URL_TTL_SECONDS = 300;

/** Форма UUID: `paymentId` и `fileId` — uuid-колонки. */
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* ------------------------------------------------------------------ */
/*  Доменная модель                                                    */
/* ------------------------------------------------------------------ */

/**
 * Файл в том виде, в каком его видит клиент.
 *
 * Ни `storagePath`, ни URL здесь нет намеренно: URL — не свойство файла, а
 * результат отдельной операции (`getSpecItemFileUrl`), и он короткоживущий.
 */
export type SpecItemFileEntry = {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  category: SpecItemFileCategory;
  uploadedBy: string | null;
  /**
   * Имя автора загрузки. `null` — имени нет (пользователя удалили).
   *
   * Читается из `users` при выдаче списка, а не хранится снимком: у файла нет
   * колонки имени, в отличие от `spec_item_events.actor_name_snapshot`. Показывать
   * `uploadedBy` вместо имени нельзя — это внутренний идентификатор.
   */
  uploadedByName: string | null;
  createdAt: string;
  /**
   * Оплата, к которой прикреплён документ. `null` — обычный файл позиции.
   *
   * Поле есть у КАЖДОЙ записи, а не только у пришедшей от оплаты: список файлов
   * показывает связь по нему, и `undefined` в одном ответе и `null` в другом
   * означали бы для клиента два разных «нет».
   */
  paymentId: string | null;
  /**
   * Вид и дата связанной оплаты — подпись документа. `null` — либо оплаты нет,
   * либо её не удалось прочитать (тогда строка остаётся обычным документом).
   */
  payment: SpecItemFilePaymentInfo | null;
};

/**
 * Что известно о связанной оплате — ровно то, чем её называет интерфейс.
 *
 * Отдельный тип, а не `PaymentEntry` целиком: файлу не нужны ни суммы, ни
 * автор оплаты, и тащить их в ответ значило бы отдавать данные, которых
 * карточка файла не показывает. Вид и дата — то, по чему документ узнают:
 * «Чек · оплата от 15 октября 2026».
 *
 * Идентификатора оплаты здесь нет: он лежит рядом, в `paymentId` записи файла.
 * Хранить его в двух полях значило бы разрешить им разойтись.
 *
 * `paidAt` — `null`, если у оплаты не заполнена дата: тогда подпись остаётся
 * видом записи.
 */
export type SpecItemFilePaymentInfo = {
  kind: PaymentRecordKind;
  paidAt: string | null;
  /**
   * Подписи нет, потому что оплаты по ссылке уже нет.
   *
   * Отмена оплаты документ не удаляет (решение тикета), но `payment_id` в
   * строке файла остаётся. Такой файл виден во вкладке «Файлы» и должен
   * честно говорить, что проводка отменена, — иначе связь в данных есть, а
   * объяснения ей нет.
   */
  cancelled: boolean;
};

/** Причина отказа, которую action превращает в `ActionResult`. */
export type SpecItemFileError = {
  code: "NOT_FOUND" | "INVALID_INPUT" | "FAILED";
  message: string;
};

export type ListSpecItemFilesResult =
  | { ok: true; files: SpecItemFileEntry[] }
  | { ok: false; error: SpecItemFileError };

export type UploadSpecItemFileResult =
  | { ok: true; file: SpecItemFileEntry }
  | { ok: false; error: SpecItemFileError };

export type GetSpecItemFileUrlResult =
  | { ok: true; url: string; expiresAt: string; file: SpecItemFileEntry }
  | { ok: false; error: SpecItemFileError };

export type DeleteSpecItemFileResult =
  | {
      ok: true;
      /**
       * Строка в том виде, в каком её видит клиент: с оплатой и всеми полями.
       *
       * Нужна карточке оплаты, где документ удаляется из списка: вычеркнуть
       * строку по идентификатору мало — интерфейсу иногда нужно показать, что
       * именно исчезло. Это запись, какой она была ДО мягкого удаления; что оно
       * состоялось, говорит флаг `deleted` ниже.
       */
      file: SpecItemFileEntry;
      /**
       * `true` — строку удалили этим вызовом; `false` — она была удалена раньше
       * (повторный вызов). Ровно этот флаг отличает идемпотентный повтор от
       * первой операции, и по нему видно, трогали ли мы Storage.
       */
      deleted: boolean;
    }
  | { ok: false; error: SpecItemFileError };

/**
 * Результат правки метаданных файла: вид документа и/или имя.
 *
 * `changed` — что именно поменялось. Нужен, чтобы интерфейс не показывал
 * «сохранено» на запрос, который ничего не изменил (пользователь открыл
 * селект и выбрал то же значение), и чтобы вызывающий не гадал по сравнению
 * `before`/`after`.
 */
export type UpdateSpecItemFileResult =
  | { ok: true; file: SpecItemFileEntry; changed: boolean }
  | { ok: false; error: SpecItemFileError };

/* ------------------------------------------------------------------ */
/*  Вход операции                                                      */
/* ------------------------------------------------------------------ */

/** Данные загрузки, которые разрешено передать снаружи.
 *
 * `bytes`, `fileName` и `category` — пользовательские. Проект, организация,
 * позиция, путь, автор и время приходят в аргументах функции, а не отсюда:
 * их определяет сервер.
 */
export type UploadSpecItemFileData = {
  bytes: Uint8Array;
  /** Оригинальное имя, как его прислал клиент (может быть пустым/грязным). */
  fileName: string | null;
  /** Объявленный браузером MIME. Не доказательство — только заявка. */
  declaredMime: string;
  /** Вид документа от клиента; `null` — «не указан», сохранится `document`. */
  category: string | null;
};

/** Кто и куда загружает: организация и позиция уже проверены action'ом. */
export type UploadSpecItemFileInput = {
  orgId: string;
  /** Проект, в контексте которого вызвана операция: сверяется с позицией. */
  projectId: string;
  specItemId: string;
  uploadedBy: string | null;
  /**
   * Имя автора — как его знает сервер (`ctx.user.name`), а не как его прислал
   * клиент.
   *
   * Нужно в ОТВЕТЕ, а не только при чтении списка: загруженная запись встаёт в
   * список ровно такой, какой её вернул сервер (второго запроса клиент не
   * делает), и без имени новая строка выглядела бы безымянной рядом со старыми.
   */
  uploadedByName?: string | null;
  /**
   * Оплата, к которой прикрепляется документ.
   *
   * `null`/`undefined`/пустая строка — обычный файл позиции. Значение приходит
   * от клиента, поэтому оно НЕ принимается на веру: ядро само читает строку
   * оплаты и сверяет позицию, организацию и проект (`resolvePayment`).
   */
  paymentId?: string | null;
  data: UploadSpecItemFileData;
};

/* ------------------------------------------------------------------ */
/*  Строки БД                                                          */
/* ------------------------------------------------------------------ */

/** Колонки, нужные ядру. Литерал обязателен: по нему supabase-js выводит тип. */
const FILE_COLUMNS =
  "id, org_id, project_id, spec_item_id, storage_path, file_name, mime_type, size_bytes, category, uploaded_by, created_at, deleted_at, payment_id";

type FileRow = {
  id: string;
  org_id: string;
  project_id: string;
  spec_item_id: string;
  storage_path: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  category: string;
  uploaded_by: string | null;
  created_at: string;
  deleted_at: string | null;
  payment_id: string | null;
};

/**
 * Строка без служебных полей — то, что уходит клиенту.
 *
 * `payment` приходит аргументом, а не читается здесь: у строки есть только
 * `payment_id`, а вид и дата записи живут в другой таблице. Где они уже
 * прочитаны (загрузка, список) — передаются; где не читаются (ссылка,
 * удаление) — запись отдаёт `paymentId` и `payment: null`, то есть честно
 * говорит, что связи нет, но не выдумывает её отсутствие в данных.
 */
function toEntry(
  row: FileRow,
  payment: SpecItemFilePaymentInfo | null = null,
  uploadedByName: string | null = null,
): SpecItemFileEntry {
  return {
    id: row.id,
    fileName: row.file_name,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes),
    category: isSpecItemFileCategory(row.category) ? row.category : "other",
    uploadedBy: row.uploaded_by,
    uploadedByName,
    createdAt: row.created_at,
    paymentId: row.payment_id ?? null,
    payment,
  };
}

function notFound(message = "Файл не найден"): {
  ok: false;
  error: SpecItemFileError;
} {
  return { ok: false, error: { code: "NOT_FOUND", message } };
}

function invalidInput(message: string): {
  ok: false;
  error: SpecItemFileError;
} {
  return { ok: false, error: { code: "INVALID_INPUT", message } };
}

function failed(message: string): { ok: false; error: SpecItemFileError } {
  return { ok: false, error: { code: "FAILED", message } };
}

/* ------------------------------------------------------------------ */
/*  Оплата, к которой прикреплён документ                              */
/* ------------------------------------------------------------------ */

/** Строка оплаты в объёме, нужном файлу: вид, дата и «жива ли ещё». */
type PaymentRow = {
  id: string;
  kind: string;
  paid_at: string | null;
  deleted_at: string | null;
};

/**
 * Оплата по идентификатору — ТОЛЬКО внутри этой позиции, этой организации и
 * этого проекта.
 *
 * Условия запроса и есть проверка принадлежности: чужой `payment_id` не находит
 * строку, и вызывающий получает `missing`, а не «чужую оплату». Отдельного
 * «прочитать и сравнить» нет намеренно — сравнение в коде можно забыть, а
 * условие выборки забыть нельзя.
 *
 * Мягко удалённая оплата (`deleted_at is not null`) находится, но помечается
 * отменённой: привязать к ней документ нельзя, а показать связь с отменённой
 * проводкой нужно — именно так документ и остаётся объяснимым после отмены.
 * Фильтр `.is("deleted_at", null)` здесь поэтому НЕ стоит.
 *
 * Три исхода, а не два. «Оплаты нет» и «БД недоступна» — разные вещи: первое
 * означает отказ пользователю, второе — сбой, и выдавать второе за первое
 * значило бы объяснять человеку чужой идентификатор, когда на самом деле лежит
 * база. Подписи в списке (`paymentInfoOf`, `decorateWithPayments`) разницу
 * сглаживают — им при сбое достаточно остаться без подписи.
 */
type PaymentLookup =
  | { status: "found"; payment: SpecItemFilePaymentInfo }
  | { status: "missing" }
  | { status: "failed" };

async function findPayment(
  db: SpecItemFilesDb,
  args: {
    orgId: string;
    projectId: string;
    specItemId: string;
    paymentId: string;
  },
): Promise<PaymentLookup> {
  const { data, error } = await db
    .from("spec_item_payments")
    .select("id, kind, paid_at, deleted_at")
    .eq("id", args.paymentId)
    .eq("org_id", args.orgId)
    .eq("spec_item_id", args.specItemId)
    .eq("project_id", args.projectId)
    .maybeSingle<PaymentRow>();

  if (error) {
    console.error("[spec-item-files] payment", error.message);
    return { status: "failed" };
  }

  if (!data) return { status: "missing" };

  return { status: "found", payment: toPaymentInfo(data) };
}

/**
 * Строка оплаты → то, чем её называет интерфейс.
 *
 * Незнакомый вид читается как оплата (`isPaymentKind`) — та же граница, что у
 * суммы в `payment-mutations`: испорченное значение поля не должно превращать
 * документ в нечитаемый.
 */
function toPaymentInfo(row: PaymentRow): SpecItemFilePaymentInfo {
  return {
    kind: isPaymentKind(row.kind) ? row.kind : "payment",
    paidAt: row.paid_at ?? null,
    cancelled: row.deleted_at !== null,
  };
}

/**
 * Подпись для ссылки, за которой оплаты уже нет.
 *
 * Так выглядит документ к отменённой оплате: `payment_id` в строке остался
 * (финансовая история не чистится, и мягкое удаление ссылку не рвёт), а живой
 * записи по нему нет. Показывать «К оплате от …» в этом случае было бы ложью,
 * а молчать — оставлять связь без объяснения. Дата и вид записи потеряны
 * вместе со строкой оплаты, поэтому подпись говорит только о факте отмены.
 */
const CANCELLED_PAYMENT_INFO: SpecItemFilePaymentInfo = {
  kind: "payment",
  paidAt: null,
  cancelled: true,
};

/**
 * Разбор `payment_id` из аргументов операции.
 *
 * Пустая строка — то же, что «не указан»: в `FormData` поле всегда есть, и
 * пустое значение означает «обычный файл позиции», а не ошибку клиента.
 * Непустое обязано быть uuid: иначе PostgREST ответил бы ошибкой приведения
 * типа вместо понятного отказа (тот же приём, что в action для `fileId`).
 */
export function normalizePaymentIdFilter(
  raw: string | null | undefined,
): { ok: true; paymentId: string | null } | { ok: false } {
  if (raw === null || raw === undefined) return { ok: true, paymentId: null };

  const trimmed = raw.trim();
  if (trimmed.length === 0) return { ok: true, paymentId: null };

  return UUID_PATTERN.test(trimmed)
    ? { ok: true, paymentId: trimmed }
    : { ok: false };
}

/**
 * Оплата существует, жива и принадлежит этой позиции — или понятный отказ.
 *
 * Текст отказа ОДИН на все случаи расхождения (чужой идентификатор, чужая
 * позиция, чужой проект, чужая организация, отменённая оплата): пользователь не
 * должен по формулировке узнавать о чужих строках больше, чем о несуществующих.
 * Тот же принцип, что у `resolveSpecItem` — один ответ на «нет» и «не твоё».
 *
 * Отказ по сбою чтения — ДРУГОЙ (`FAILED`, «не удалось»): он не утверждает, что
 * оплаты нет, и повтор операции имеет смысл.
 */
async function resolvePayment(
  db: SpecItemFilesDb,
  args: {
    orgId: string;
    projectId: string;
    specItemId: string;
    paymentId: string | null | undefined;
  },
): Promise<
  | {
      ok: true;
      paymentId: string | null;
      payment: SpecItemFilePaymentInfo | null;
    }
  | { ok: false; error: SpecItemFileError }
> {
  /** Один текст на все расхождения — см. заголовок. */
  const notFoundError: SpecItemFileError = {
    code: "INVALID_INPUT",
    message: "Оплата не найдена: проверьте, к какой записи прикрепляете документ",
  };

  const normalized = normalizePaymentIdFilter(args.paymentId);
  if (!normalized.ok) return { ok: false, error: notFoundError };

  if (normalized.paymentId === null) {
    return { ok: true, paymentId: null, payment: null };
  }

  const found = await findPayment(db, {
    orgId: args.orgId,
    projectId: args.projectId,
    specItemId: args.specItemId,
    paymentId: normalized.paymentId,
  });

  if (found.status === "failed") {
    return {
      ok: false,
      error: { code: "FAILED", message: "Не удалось проверить оплату" },
    };
  }

  if (found.status === "missing") return { ok: false, error: notFoundError };

  // Отменённая оплата — тот же отказ: документ прикрепляют к действующей
  // проводке, а не к записи, которая больше не считается в суммах.
  if (found.payment.cancelled) return { ok: false, error: notFoundError };

  return { ok: true, paymentId: normalized.paymentId, payment: found.payment };
}

/**
 * Подпись оплаты для ОДНОЙ уже прочитанной строки файла.
 *
 * Нужна операции, которая отдаёт запись целиком (ссылка на файл): клиент
 * обновляет по ответу свою строку, и без подписи связь с оплатой в ней пропала
 * бы — при том что в данных она есть. Отдельно от `decorateWithPayments`
 * (пачка) по той же причине, по которой `resolvePayment` отделён от списка:
 * одиночной операции незачем читать оплаты чужих файлов. Сбой чтения подписи не
 * поднимается наверх — запись остаётся «файлом без подписи», и это ровно то, что
 * видит клиент: сама ссылка на оплату (`paymentId`) лежит в строке.
 */
async function paymentInfoOf(
  db: SpecItemFilesDb,
  args: { orgId: string; projectId: string; specItemId: string },
  paymentId: string | null,
): Promise<SpecItemFilePaymentInfo | null> {
  if (!paymentId) return null;

  const found = await findPayment(db, { ...args, paymentId });
  return found.status === "found" ? found.payment : null;
}

/**
 * Подписи оплаты для списка файлов.
 *
 * Один дополнительный запрос на список, а не соединение таблиц в основном:
 * соединение потребовало бы фильтра «оплата не удалена» на уровне PostgREST
 * (`spec_item_payments!inner(...)`), а он сделал бы выборку внутренним join —
 * и файлы без оплаты исчезли бы из списка вовсе. Здесь же читается пачка оплат
 * по идентификаторам, и строка без оплаты просто остаётся без подписи.
 *
 * Читаются и ОТМЕНЁННЫЕ записи (фильтра по `deleted_at` нет): документ к
 * отменённой оплате должен быть объясним, иначе он выглядел бы обычным файлом,
 * а его `payment_id` вёл бы в никуда. Такой документ получает подпись
 * «К отменённой оплате».
 *
 * Ошибка чтения оплат список НЕ ломает: документы важнее подписи, и файл без
 * вида оплаты показывается как обычный. Ошибка уходит в лог.
 */
async function decorateWithPayments(
  db: SpecItemFilesDb,
  args: {
    orgId: string;
    specItemId: string;
    files: SpecItemFileEntry[];
  },
): Promise<SpecItemFileEntry[]> {
  const paymentIds = Array.from(
    new Set(
      args.files
        .map((file) => file.paymentId)
        .filter((id): id is string => id !== null),
    ),
  );

  if (paymentIds.length === 0) return args.files;

  const { data, error } = await db
    .from("spec_item_payments")
    .select("id, kind, paid_at, deleted_at")
    .eq("org_id", args.orgId)
    .eq("spec_item_id", args.specItemId)
    .in("id", paymentIds);

  if (error) {
    console.error("[listSpecItemFiles] payments", error.message);
    return args.files;
  }

  const byId = new Map<string, SpecItemFilePaymentInfo>();
  for (const row of (data ?? []) as PaymentRow[]) {
    byId.set(row.id, toPaymentInfo(row));
  }

  // Ссылка есть, а строки по ней нет (оплату удалили физически, строка попала в
  // БД в обход кода) — подпись всё равно нужна: молчание оставило бы `paymentId`
  // без объяснения, а таким же он выглядел бы и при отменённой оплате.
  return args.files.map((file) => ({
    ...file,
    payment: file.paymentId
      ? (byId.get(file.paymentId) ?? CANCELLED_PAYMENT_INFO)
      : null,
  }));
}

/**
 * Имена авторов загрузки для списка файлов.
 *
 * Тот же приём, что у подписей оплат: один запрос на пачку идентификаторов.
 * Имя нужно строке («размер · дата · автор»), а в таблице файлов лежит только
 * ссылка на `users`. Ошибка чтения имён список не ломает — автор просто не
 * показывается, а файлы важнее подписи.
 */
async function decorateWithAuthors(
  db: SpecItemFilesDb,
  files: SpecItemFileEntry[],
): Promise<SpecItemFileEntry[]> {
  const userIds = Array.from(
    new Set(
      files.map((file) => file.uploadedBy).filter((id): id is string => id !== null),
    ),
  );

  if (userIds.length === 0) return files;

  const { data, error } = await db
    .from("users")
    .select("id, name")
    .in("id", userIds);

  if (error) {
    console.error("[listSpecItemFiles] users", error.message);
    return files;
  }

  const byId = new Map<string, string | null>();
  for (const row of (data ?? []) as { id: string; name: string | null }[]) {
    byId.set(row.id, row.name);
  }

  return files.map((file) => ({
    ...file,
    uploadedByName: file.uploadedBy ? (byId.get(file.uploadedBy) ?? null) : null,
  }));
}

/* ------------------------------------------------------------------ */
/*  Проверка позиции                                                   */
/* ------------------------------------------------------------------ */

type SpecItemRow = {
  id: string;
  org_id: string;
  project_id: string;
  deleted_at: string | null;
};

/**
 * Позиция в этой организации, в этом проекте и не удалённая.
 *
 * Проверка организации идёт по `org_id` из сессии, а не по аргументу: чужой id
 * не даёт ни файлов, ни сведения о том, существует ли он. Тот же паттерн, что
 * в `resolveItem` у комментариев (`actions/spec-comments.ts`).
 */
async function resolveSpecItem(
  db: SpecItemFilesDb,
  args: { orgId: string; projectId: string; specItemId: string },
): Promise<
  | { ok: true; item: SpecItemRow }
  | { ok: false; error: SpecItemFileError }
> {
  const { data, error } = await db
    .from("spec_items")
    .select("id, org_id, project_id, deleted_at")
    .eq("id", args.specItemId)
    .eq("org_id", args.orgId)
    .eq("project_id", args.projectId)
    .maybeSingle<SpecItemRow>();

  if (error) {
    console.error("[spec-item-files] item", error.message);
    return failed("Не удалось получить файлы позиции");
  }

  // Удалённая позиция не принимает файлы и не отдаёт их: её карточка закрыта —
  // так же, как у комментариев.
  if (!data || data.deleted_at !== null) return notFound("Позиция не найдена");

  return { ok: true, item: data };
}

/* ------------------------------------------------------------------ */
/*  list                                                               */
/* ------------------------------------------------------------------ */

/**
 * Активные файлы позиции: `created_at desc, id desc`.
 *
 * Именно этот порядок покрыт частичным индексом
 * `spec_item_files_spec_item_id_active_idx`, поэтому сортировка в запросе и в
 * схеме — одно правило, а не два.
 *
 * Связь с оплатой достраивается вторым запросом (`decorateWithPayments`): у
 * строки файла есть только `payment_id`, а подпись документа называет вид и
 * дату записи — они живут в `spec_item_payments`. Без этого вкладка «Файлы»
 * показывала бы чек как обычный документ.
 */
export async function listSpecItemFiles(
  db: SpecItemFilesDb,
  args: { orgId: string; projectId: string; specItemId: string },
): Promise<ListSpecItemFilesResult> {
  const item = await resolveSpecItem(db, args);
  if (!item.ok) return { ok: false, error: item.error };

  const { data, error } = await db
    .from("spec_item_files")
    .select(FILE_COLUMNS)
    .eq("org_id", args.orgId)
    .eq("spec_item_id", args.specItemId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false });

  if (error) {
    console.error("[listSpecItemFiles]", error.message);
    return failed("Не удалось получить файлы позиции");
  }

  const files = (data ?? []).map((row) => toEntry(row as FileRow));

  return {
    ok: true,
    files: await decorateWithAuthors(
      db,
      await decorateWithPayments(db, {
        orgId: args.orgId,
        specItemId: args.specItemId,
        files,
      }),
    ),
  };
}

/* ------------------------------------------------------------------ */
/*  upload                                                             */
/* ------------------------------------------------------------------ */

/**
 * Разбор и проверка загружаемых данных.
 *
 * Здесь нет ни БД, ни Storage — только правила: вид документа, размер, MIME,
 * сигнатура содержимого и нормализация имени. Вынесено отдельной функцией,
 * чтобы правила можно было проверить без подставных клиентов.
 */
export function validateUploadData(data: UploadSpecItemFileData): {
  ok: true;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  category: SpecItemFileCategory;
} | { ok: false; error: SpecItemFileError } {
  /**
   * Вид документа: явно указанный главнее догадки, иначе — догадка сервера.
   *
   * Указанное, но не из списка значение — ошибка: «другое» для опечатки скрыло
   * бы проблему клиента. А вот ОТСУТСТВИЕ вида ошибкой не является: это и есть
   * основной путь (`guessSpecItemFileCategory`), где вид определяется по
   * подтверждённому формату файла, а не спрашивается диалогом.
   */
  const rawCategory = (data.category ?? "").trim();
  if (rawCategory !== "" && !isSpecItemFileCategory(rawCategory)) {
    return invalidInput("Неизвестный вид документа");
  }
  const category: SpecItemFileCategory = isSpecItemFileCategory(rawCategory)
    ? rawCategory
    : guessSpecItemFileCategory({
        mimeType: normalizeMimeType(data.declaredMime),
        fileName: data.fileName,
      });

  const fileName = normalizeFileName(data.fileName);
  if (!fileName) return invalidInput("У файла нет имени");

  const bytes = data.bytes;
  if (bytes.length === 0) return invalidInput("Файл пустой");
  if (bytes.length > MAX_SPEC_ITEM_FILE_BYTES) {
    return invalidInput(`Файл больше ${MAX_SPEC_ITEM_FILE_LABEL}`);
  }

  const mimeType = normalizeMimeType(data.declaredMime);
  if (!isAllowedSpecItemFileMime(mimeType)) {
    return invalidInput(`Тип файла «${mimeType}» не поддерживается`);
  }

  const mismatch = checkDeclaredMimeMatchesContent({
    declaredMime: mimeType,
    fileName,
    bytes,
  });
  if (mismatch) return invalidInput(mismatch);

  return { ok: true, fileName, mimeType, sizeBytes: bytes.length, category };
}

/**
 * Best-effort удаление объекта: ошибка только логируется.
 *
 * Нужно как компенсация при неудачном INSERT и как финальный шаг мягкого
 * удаления — в обоих случаях отказ Storage не должен менять результат
 * операции, потому что истина живёт в БД.
 */
async function removeQuietly(
  storage: SpecItemFilesStorage,
  path: string,
): Promise<boolean> {
  try {
    const { error } = await storage.remove(path);
    if (error) {
      console.error("[spec-item-files] storage remove", path, error.message);
      return false;
    }
    return true;
  } catch (cause) {
    console.error("[spec-item-files] storage remove", path, cause);
    return false;
  }
}

/**
 * Загрузка файла: Storage → INSERT → (при отказе INSERT) компенсирующее удаление.
 */
export async function uploadSpecItemFile(
  db: SpecItemFilesDb,
  storage: SpecItemFilesStorage,
  input: UploadSpecItemFileInput,
): Promise<UploadSpecItemFileResult> {
  const item = await resolveSpecItem(db, {
    orgId: input.orgId,
    projectId: input.projectId,
    specItemId: input.specItemId,
  });
  if (!item.ok) return { ok: false, error: item.error };

  const validated = validateUploadData(input.data);
  if (!validated.ok) return { ok: false, error: validated.error };

  // Привязка к оплате проверяется ДО Storage и до INSERT: чужой `payment_id` —
  // это отказ пользователю, а не объект, оставленный в bucket'е. Проверка идёт
  // по строке оплаты в БД, а не по доверию аргументу.
  const payment = await resolvePayment(db, {
    orgId: input.orgId,
    projectId: item.item.project_id,
    specItemId: item.item.id,
    paymentId: input.paymentId,
  });
  if (!payment.ok) return { ok: false, error: payment.error };

  // id генерирует сервер, а не БД: он входит в путь объекта, который нужно
  // знать ДО вставки. Тот же генератор, что у `gen_random_uuid()` по умолчанию.
  const fileId = globalThis.crypto.randomUUID();
  const storagePath = buildSpecItemFilePath({
    orgId: input.orgId,
    specItemId: input.specItemId,
    extension: extensionForMime(validated.mimeType),
    fileId,
  });

  let uploaded = false;
  try {
    const { error } = await storage.upload({
      path: storagePath,
      bytes: input.data.bytes,
      contentType: validated.mimeType,
    });

    if (error) {
      console.error("[uploadSpecItemFile] storage upload", error.message);
      return failed("Не удалось загрузить файл");
    }
    uploaded = true;

    const { data, error: insertError } = await db
      .from("spec_item_files")
      .insert({
        id: fileId,
        org_id: input.orgId,
        project_id: item.item.project_id,
        spec_item_id: item.item.id,
        storage_path: storagePath,
        file_name: validated.fileName,
        mime_type: validated.mimeType,
        size_bytes: validated.sizeBytes,
        category: validated.category,
        // Оплата — уже проверенная строка: сюда попадает `id` найденной записи,
        // а не то, что прислал клиент.
        payment_id: payment.paymentId,
        // Автор и время — серверные. Ни то, ни другое не приходит от клиента.
        uploaded_by: input.uploadedBy,
        created_at: new Date().toISOString(),
      })
      .select(FILE_COLUMNS)
      .single();

    if (insertError || !data) {
      console.error(
        "[uploadSpecItemFile] insert",
        insertError?.message ?? "нет строки",
      );
      // Компенсация: объекта без строки остаться не должно — приложение читает
      // файлы из БД, и такой объект никто никогда не увидит.
      await removeQuietly(storage, storagePath);
      return failed("Не удалось сохранить файл");
    }

    return {
      ok: true,
      file: toEntry(data as FileRow, payment.payment, input.uploadedByName ?? null),
    };
  } catch (cause) {
    // Сетевой сбой может вылететь исключением на любом шаге. Если объект уже
    // загружен — компенсируем, иначе оставили бы orphan.
    console.error("[uploadSpecItemFile]", cause);
    if (uploaded) await removeQuietly(storage, storagePath);
    return failed("Не удалось загрузить файл");
  }
}

/* ------------------------------------------------------------------ */
/*  getUrl                                                             */
/* ------------------------------------------------------------------ */

/**
 * Короткоживущий signed URL по идентификатору файла.
 *
 * Путь берётся из строки БД и сверяется с ожидаемым префиксом. Клиент не может
 * передать ни `storage_path`, ни URL: их нет в аргументах.
 *
 * ── Просмотр и скачивание ─────────────────────────────────────────────────
 *
 * `download` — «пользователь хочет сохранить файл», а не «открыть». Тогда имя
 * для заголовка берётся из строки (`file_name`) и нормализуется заново:
 * `normalizeFileName` снимает переводы строк (защита от подделки заголовка) и
 * пути. При загрузке и правке имя уже нормализовано — это второй контур для
 * строки, записанной в БД в обход кода.
 *
 * Имя НЕ приходит от клиента: подставлять в `Content-Disposition` то, что
 * прислала форма, нельзя. Скачивают ровно то имя, которое видно в списке, —
 * за это отвечает `file_name` строки, а не догадка вызывающего.
 */
export async function getSpecItemFileUrl(
  db: SpecItemFilesDb,
  storage: SpecItemFilesStorage,
  args: {
    orgId: string;
    projectId: string;
    specItemId: string;
    fileId: string;
    /** Переопределение TTL (тесты); по умолчанию — 5 минут. */
    expiresIn?: number;
    /** `true` — отдать файл вложением под его оригинальным именем. */
    download?: boolean;
    /**
     * Имя автора загрузки — как его знает сервер (`ctx.user.name`).
     *
     * Нужно только для ответа: в БД имени автора нет (там ссылка на `users`),
     * а вызывающий обновляет строку именно ответом. Иначе после открытия файла
     * строка теряла бы автора.
     */
    uploadedByName?: string | null;
  },
): Promise<GetSpecItemFileUrlResult> {
  const item = await resolveSpecItem(db, args);
  if (!item.ok) return { ok: false, error: item.error };

  const { data, error } = await db
    .from("spec_item_files")
    .select(FILE_COLUMNS)
    .eq("id", args.fileId)
    .eq("org_id", args.orgId)
    .eq("spec_item_id", args.specItemId)
    .maybeSingle<FileRow>();

  if (error) {
    console.error("[getSpecItemFileUrl]", error.message);
    return failed("Не удалось открыть файл");
  }

  if (!data || data.deleted_at !== null) return notFound();

  // Строка есть, но путь ведёт в чужую позицию или чужую организацию: значит,
  // её записали в обход кода. Подписывать такой объект нельзя.
  if (
    !isSpecItemFilePathExpected({
      storagePath: data.storage_path,
      orgId: args.orgId,
      specItemId: args.specItemId,
    })
  ) {
    console.error("[getSpecItemFileUrl] неожиданный storage_path", data.id);
    return failed("Не удалось открыть файл");
  }

  const expiresIn = args.expiresIn ?? SPEC_ITEM_FILE_URL_TTL_SECONDS;
  const downloadName = args.download ? normalizeFileName(data.file_name) : "";

  try {
    const { data: signed, error: signError } = await storage.createSignedUrl({
      path: data.storage_path,
      expiresIn,
      // Пустое имя после нормализации означает, что строка испорчена (в БД
      // лежит имя из одних пробелов): скачивание остаётся скачиванием, а имя
      // подставит Storage (`true`).
      download: !args.download ? null : downloadName.length > 0 ? downloadName : true,
    });

    if (signError || !signed?.signedUrl) {
      console.error(
        "[getSpecItemFileUrl] sign",
        signError?.message ?? "нет ссылки",
      );
      return failed("Не удалось открыть файл");
    }

    return {
      ok: true,
      url: signed.signedUrl,
      expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
      file: toEntry(
        data,
        await paymentInfoOf(db, args, data.payment_id),
        args.uploadedByName ?? null,
      ),
    };
  } catch (cause) {
    console.error("[getSpecItemFileUrl]", cause);
    return failed("Не удалось открыть файл");
  }
}

/* ------------------------------------------------------------------ */
/*  delete                                                             */
/* ------------------------------------------------------------------ */

/**
 * Мягкое удаление: строка первой, объект — best-effort.
 *
 * `deleted_at = now()` — единственное изменение строки. Условие `deleted_at is
 * null` в UPDATE делает повторный вызов предсказуемым: второй раз строка не
 * обновится, и мы не полезем в Storage за объектом, которого уже нет.
 */
export async function deleteSpecItemFile(
  db: SpecItemFilesDb,
  storage: SpecItemFilesStorage,
  args: {
    orgId: string;
    projectId: string;
    specItemId: string;
    fileId: string;
  },
): Promise<DeleteSpecItemFileResult> {
  const item = await resolveSpecItem(db, args);
  if (!item.ok) return { ok: false, error: item.error };

  const { data: row, error } = await db
    .from("spec_item_files")
    .select(FILE_COLUMNS)
    .eq("id", args.fileId)
    .eq("org_id", args.orgId)
    .eq("spec_item_id", args.specItemId)
    .maybeSingle<FileRow>();

  if (error) {
    console.error("[deleteSpecItemFile] read", error.message);
    return failed("Не удалось удалить файл");
  }

  if (!row) return notFound();

  // В ответе — запись ДО удаления, вместе со ссылкой на оплату из строки. Читать
  // ради этого оплату отдельным запросом незачем: подпись (`payment`) у
  // удалённого документа не показывается, а `paymentId` уже лежит в строке.
  const entry = toEntry(row);

  // Повторный вызов: строка уже удалена. Storage не трогаем — объект мог быть
  // удалён первым вызовом, а второй remove вернул бы ошибку «не найдено»,
  // которая ничего не значит.
  if (row.deleted_at !== null) {
    return { ok: true, file: entry, deleted: false };
  }

  if (
    !isSpecItemFilePathExpected({
      storagePath: row.storage_path,
      orgId: args.orgId,
      specItemId: args.specItemId,
    })
  ) {
    console.error("[deleteSpecItemFile] неожиданный storage_path", row.id);
    return failed("Не удалось удалить файл");
  }

  const deletedAt = new Date().toISOString();

  const { data: updated, error: updateError } = await db
    .from("spec_item_files")
    .update({ deleted_at: deletedAt })
    .eq("id", row.id)
    .eq("org_id", args.orgId)
    .eq("spec_item_id", args.specItemId)
    .is("deleted_at", null)
    .select(FILE_COLUMNS)
    .maybeSingle<FileRow>();

  if (updateError) {
    console.error("[deleteSpecItemFile] update", updateError.message);
    return failed("Не удалось удалить файл");
  }

  // `null` здесь означает гонку: строку удалил параллельный запрос. Для
  // пользователя результат тот же — файла нет, — поэтому это успех, а не отказ.
  if (!updated) {
    return { ok: true, file: entry, deleted: false };
  }

  // Истина уже в БД: файл исчез из списка и больше не подписывается. Ошибка
  // Storage не откатывает удаление и не превращает операцию в неуспешную.
  await removeQuietly(storage, row.storage_path);

  return { ok: true, file: entry, deleted: true };
}

/* ------------------------------------------------------------------ */
/*  update                                                             */
/* ------------------------------------------------------------------ */

/**
 * Правка метаданных файла: вид документа и оригинальное имя.
 *
 * ── Почему это одна операция, а не две ────────────────────────────────────
 *
 * И вид, и имя — поля ОДНОЙ строки, правит их один и тот же человек по одному и
 * тому же праву, и живут они в одном диалоге/меню. Разводить их по двум
 * действиям значило бы завести два запроса на одну правку и два места, где
 * проверяется принадлежность файла позиции.
 *
 * ── Что НЕ правится ───────────────────────────────────────────────────────
 *
 * * `storage_path` — путь объекта в Storage. Имя объекта там UUID, и оно не
 *   зависит от `file_name`: переименование файла не двигает объект и не требует
 *   его повторной загрузки. Это ключевое свойство модели: имя файла и имя
 *   объекта разделены намеренно (см. заголовок модуля), и именно поэтому
 *   переименование — дешёвая операция над строкой БД;
 * * `mime_type` и `size_bytes` — производные содержимого. Их нельзя «поправить»
 *   иначе как загрузив другой файл, а правка вручную разошлась бы с объектом;
 * * `category` на что-либо, кроме закрытого списка (`INVALID_INPUT`).
 *
 * ── Границы доверия ───────────────────────────────────────────────────────
 *
 * Имя приходит от клиента, поэтому нормализуется тем же `normalizeFileName`,
 * что и при загрузке: снимаются пути, управляющие символы и переводы строк
 * (имя уходит в `Content-Disposition` при скачивании), обрезается длина. Пустое
 * после нормализации имя — отказ, а не «оставить как было»: пользователь стёр
 * имя намеренно, и молча вернуть старое значило бы соврать об успехе.
 *
 * ── Порядок проверок ──────────────────────────────────────────────────────
 *
 * 1. позиция в этой организации и проекте (`NOT_FOUND`);
 * 2. файл в этой организации и позиции (`NOT_FOUND`);
 * 3. файл не удалён (`NOT_FOUND`) — мягко удалённый файл не правится: он уже
 *    не показывается, и правка была бы невидимой;
 * 4. путь объекта ожидаемый (`FAILED`) — как у чтения и удаления: строка,
 *    записанная в обход кода, не должна становиться «правимой»;
 * 5. значения полей (`INVALID_INPUT`).
 *
 * Правка НЕ трогает журнал позиции (`spec_item_events`): файлы туда не
 * пишутся и при загрузке с удалением, и заводить событие только для
 * переименования значило бы завести половину истории файла.
 */
export async function updateSpecItemFile(
  db: SpecItemFilesDb,
  args: {
    orgId: string;
    projectId: string;
    specItemId: string;
    fileId: string;
    /** Новый вид документа; `undefined` — не менять. */
    category?: string | null;
    /** Новое имя файла; `undefined` — не менять. */
    fileName?: string | null;
    /** Имя автора загрузки: нужно только для ответа (см. `getSpecItemFileUrl`). */
    uploadedByName?: string | null;
  },
): Promise<UpdateSpecItemFileResult> {
  const item = await resolveSpecItem(db, args);
  if (!item.ok) return { ok: false, error: item.error };

  const { data: row, error } = await db
    .from("spec_item_files")
    .select(FILE_COLUMNS)
    .eq("id", args.fileId)
    .eq("org_id", args.orgId)
    .eq("spec_item_id", args.specItemId)
    .maybeSingle<FileRow>();

  if (error) {
    console.error("[updateSpecItemFile] read", error.message);
    return failed("Не удалось сохранить файл");
  }

  if (!row || row.deleted_at !== null) return notFound();

  if (
    !isSpecItemFilePathExpected({
      storagePath: row.storage_path,
      orgId: args.orgId,
      specItemId: args.specItemId,
    })
  ) {
    console.error("[updateSpecItemFile] неожиданный storage_path", row.id);
    return failed("Не удалось сохранить файл");
  }

  const patch: { category?: SpecItemFileCategory; file_name?: string } = {};

  if (args.category !== undefined && args.category !== null) {
    const category = args.category.trim();
    if (!isSpecItemFileCategory(category)) {
      return invalidInput("Неизвестный вид документа");
    }
    if (category !== row.category) patch.category = category;
  }

  if (args.fileName !== undefined && args.fileName !== null) {
    const fileName = normalizeFileName(args.fileName);
    if (!fileName) return invalidInput("У файла нет имени");
    if (fileName !== row.file_name) patch.file_name = fileName;
  }

  // Ничего не поменялось — не пишем в БД и отвечаем тем же, что лежит в строке.
  // Это нормальный случай (открыли селект и выбрали текущее значение), а не
  // ошибка: пользователь сделал запрос, но менять было нечего.
  if (Object.keys(patch).length === 0) {
    return {
      ok: true,
      file: toEntry(
        row,
        await paymentInfoOf(db, args, row.payment_id),
        args.uploadedByName ?? null,
      ),
      changed: false,
    };
  }

  const { data: updated, error: updateError } = await db
    .from("spec_item_files")
    .update(patch)
    .eq("id", row.id)
    .eq("org_id", args.orgId)
    .eq("spec_item_id", args.specItemId)
    .is("deleted_at", null)
    .select(FILE_COLUMNS)
    .maybeSingle<FileRow>();

  if (updateError) {
    console.error("[updateSpecItemFile] update", updateError.message);
    return failed("Не удалось сохранить файл");
  }

  // `null` — гонка: строку удалили параллельно. Для пользователя это «файла
  // нет», то есть тот же `NOT_FOUND`, что и у отсутствующей строки: ответить
  // успехом значило бы показать правку файла, которого больше нет.
  if (!updated) return notFound();

  return {
    ok: true,
    file: toEntry(
      updated,
      await paymentInfoOf(db, args, updated.payment_id),
      args.uploadedByName ?? null,
    ),
    changed: true,
  };
}
