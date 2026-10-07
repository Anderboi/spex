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
 * От клиента приходят ровно три вещи: сам файл, желаемая категория и (необязательно)
 * имя файла. Всё остальное определяет сервер: `orgId` (из сессии), `specItemId`
 * (из аргумента, проверенного по организации), `projectId` (из строки позиции),
 * `storage_path` (собирается здесь), `uploaded_by` (из сессии), `created_at`
 * (серверное время), `id` (БД).
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
 *    подписываться, ни удаляться повторно «по-настоящему»;
 * 5. путь объекта ожидаемый (`FAILED`) — сюда попадает только подделка;
 * 6. категория и содержимое файла (`INVALID_INPUT`).
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
  isAllowedSpecItemFileMime,
  isSpecItemFileCategory,
  isSpecItemFilePathExpected,
  normalizeFileName,
  normalizeMimeType,
  buildSpecItemFilePath,
  type SpecItemFileCategory,
} from "./file-content";

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
  }): Promise<{
    data: { signedUrl: string } | null;
    error: StorageErrorLike;
  }>;
};

/** Время жизни signed URL. Короткое: ссылка выдаётся на один показ/скачивание. */
export const SPEC_ITEM_FILE_URL_TTL_SECONDS = 300;

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
  createdAt: string;
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
      file: SpecItemFileEntry;
      /**
       * `true` — строку удалили этим вызовом; `false` — она была удалена раньше
       * (повторный вызов). Ровно этот флаг отличает идемпотентный повтор от
       * первой операции, и по нему видно, трогали ли мы Storage.
       */
      deleted: boolean;
    }
  | { ok: false; error: SpecItemFileError };

/* ------------------------------------------------------------------ */
/*  Вход операции                                                      */
/* ------------------------------------------------------------------ */

/**
 * Данные загрузки, которые разрешено передать снаружи.
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
  /** Категория от клиента; `null` — «не указана», сохранится `other`. */
  category: string | null;
};

/** Кто и куда загружает: организация и позиция уже проверены action'ом. */
export type UploadSpecItemFileInput = {
  orgId: string;
  /** Проект, в контексте которого вызвана операция: сверяется с позицией. */
  projectId: string;
  specItemId: string;
  uploadedBy: string | null;
  data: UploadSpecItemFileData;
};

/* ------------------------------------------------------------------ */
/*  Строки БД                                                          */
/* ------------------------------------------------------------------ */

/** Колонки, нужные ядру. Литерал обязателен: по нему supabase-js выводит тип. */
const FILE_COLUMNS =
  "id, org_id, project_id, spec_item_id, storage_path, file_name, mime_type, size_bytes, category, uploaded_by, created_at, deleted_at";

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
};

/** Строка без служебных полей — то, что уходит клиенту. */
function toEntry(row: FileRow): SpecItemFileEntry {
  return {
    id: row.id,
    fileName: row.file_name,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes),
    category: isSpecItemFileCategory(row.category) ? row.category : "other",
    uploadedBy: row.uploaded_by,
    createdAt: row.created_at,
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

  return { ok: true, files: (data ?? []).map((row) => toEntry(row as FileRow)) };
}

/* ------------------------------------------------------------------ */
/*  upload                                                             */
/* ------------------------------------------------------------------ */

/**
 * Разбор и проверка загружаемых данных.
 *
 * Здесь нет ни БД, ни Storage — только правила: категория, размер, MIME,
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
  // Категория: пустое значение — это «не указана», а не ошибка. Указанное, но
  // не из списка — ошибка: `other` для опечатки скрыл бы проблему клиента.
  const rawCategory = (data.category ?? "").trim();
  if (rawCategory !== "" && !isSpecItemFileCategory(rawCategory)) {
    return invalidInput("Неизвестная категория файла");
  }
  const category: SpecItemFileCategory = isSpecItemFileCategory(rawCategory)
    ? rawCategory
    : "other";

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

    return { ok: true, file: toEntry(data as FileRow) };
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

  try {
    const { data: signed, error: signError } = await storage.createSignedUrl({
      path: data.storage_path,
      expiresIn,
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
      file: toEntry(data),
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

  // Повторный вызов: строка уже удалена. Storage не трогаем — объект мог быть
  // удалён первым вызовом, а второй remove вернул бы ошибку «не найдено»,
  // которая ничего не значит.
  if (row.deleted_at !== null) {
    return { ok: true, file: toEntry(row), deleted: false };
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
    return { ok: true, file: toEntry({ ...row, deleted_at: deletedAt }), deleted: false };
  }

  // Истина уже в БД: файл исчез из списка и больше не подписывается. Ошибка
  // Storage не откатывает удаление и не превращает операцию в неуспешную.
  await removeQuietly(storage, row.storage_path);

  return { ok: true, file: toEntry(updated), deleted: true };
}
