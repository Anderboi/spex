"use server";

import { revalidatePath } from "next/cache";
import { requireOrgBySlug } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { can } from "@/lib/permissions";
import { fail, ok, type ActionErrorCode, type ActionResult } from "@/lib/action-result";
import { SPEC_ITEM_FILES_BUCKET } from "@/lib/spec/file-content";
import {
  deleteSpecItemFile as deleteSpecItemFileCore,
  getSpecItemFileUrl as getSpecItemFileUrlCore,
  getSpecItemFileUrls as getSpecItemFileUrlsCore,
  listSpecItemFiles as listSpecItemFilesCore,
  updateSpecItemFile as updateSpecItemFileCore,
  uploadSpecItemFile as uploadSpecItemFileCore,
  type SpecItemFileEntry,
  type SpecItemFileError,
  type SpecItemFileSignedUrl,
  type SpecItemFilesStorage,
} from "@/lib/spec/spec-item-files";

/**
 * Все типы выше — только для аннотаций внутри файла: `import type` (и
 * `type`-модификатор) стирается компилятором, поэтому в манифест server actions
 * попадают ровно шесть экспортированных функций. Тот же приём в
 * `actions/spec-comments.ts` с `HistoryCommentEntry`.
 */

/**
 * Файлы позиции спецификации: список, загрузка, signed URL и мягкое удаление.
 *
 * ── Граница слоя ───────────────────────────────────────────────────────────
 *
 * Здесь только то, чего не может ядро (`lib/spec/spec-item-files.ts`): сессия,
 * `orgSlug` → `orgId`, проверка прав организации, разбор `FormData` и перевод
 * результата в `ActionResult`. Проверки принадлежности, построение пути,
 * работа с Storage и запись в БД — в ядре, и именно поэтому они покрыты
 * unit-тестами без Next, без живой БД и без сети.
 *
 * ── Кто что может ──────────────────────────────────────────────────────────
 *
 * * список — любому участнику организации: чтение правами в этом проекте не
 *   описывается (`lib/permissions.ts`: «Чтение правами не описывается»), а
 *   доступ к позиции уже ограничен организацией из сессии;
 * * загрузка — `can(role, "record:create")`: наблюдатель (viewer) отсекается
 *   той же границей, что у `uploadMaterialImage`, `uploadProjectImage`,
 *   `uploadContactImage` и RLS-политики `spec_item_comments_insert_member`;
 * * удаление — та же граница `record:create`. Отдельного права «удалить файл»
 *   в матрице нет, а `assertCanMutate` здесь неприменим: его `OwnedTable`
 *   (`lib/db/guard.ts`) знает только «projects | materials | companies |
 *   contacts» — позиции спецификации в нём нет. Поэтому проверка организации и
 *   прав повторяет существующий паттерн позиции: `resolveItem` из
 *   `actions/spec-comments.ts`. Документ, прикреплённый к оплате, живёт по тем
 *   же правилам: привязать и открепить его может тот, кто вправе загружать
 *   файлы, а не только автор самой оплаты.
 *
 * ── Про `assertCanMutate` ──────────────────────────────────────────────────
 *
 * Он не используется намеренно, а не по забывчивости: он проверяет авторство
 * строки (`created_by`) и для `spec_items` не типизирован. Файл же не имеет
 * собственного `created_by`-контракта, а роль «автор файла» в этом проекте
 * нигде не даёт дополнительных прав (у комментариев — даёт, поэтому там своё
 * правило). Вторая система прав здесь не вводится — только существующий `can`.
 */

/** Форма UUID: и `specItemId`, и `fileId` — uuid-колонки. */
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Код отказа ядра → код `ActionResult`. */
const ERROR_CODES: Record<SpecItemFileError["code"], ActionErrorCode> = {
  NOT_FOUND: "NOT_FOUND",
  INVALID_INPUT: "INVALID_INPUT",
  FAILED: "FAILED",
};

function toFailure(error: SpecItemFileError) {
  return fail(error.message, ERROR_CODES[error.code]);
}

/**
 * Позиция обязана быть в организации из сессии и не быть удалённой.
 *
 * `projectId` возвращается вместе с позицией: он нужен и для `revalidatePath`,
 * и — главное — уходит в ядро, где сверяется с `spec_items.project_id`. Так
 * `projectId` не берётся ни из формы, ни из URL: он читается из строки позиции,
 * которую мы только что проверили по организации.
 */
async function resolveItem(orgSlug: string, specItemId: string) {
  const ctx = await requireOrgBySlug(orgSlug);
  const supabase = createAdminClient();

  const { data: item, error } = await supabase
    .from("spec_items")
    .select("id, project_id, org_id")
    .eq("id", specItemId)
    .eq("org_id", ctx.orgId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) {
    // Текст ошибки БД — внутренняя деталь, а не сообщение для пользователя.
    console.error("[spec-item-files] item", error.message);
    return { ctx, supabase, item: null, failed: true as const };
  }

  return { ctx, supabase, item, failed: false as const };
}

/**
 * Адаптер Storage: единственное место, где ядро соприкасается с supabase-js.
 *
 * Ядро объявляет узкий интерфейс, поэтому Storage приходит сюда аргументом и
 * может быть подменён в тестах. Здесь нет ни одной проверки доступа: они все —
 * и в action, и в ядре.
 */
function storageOf(supabase: ReturnType<typeof createAdminClient>): SpecItemFilesStorage {
  const bucket = () => supabase.storage.from(SPEC_ITEM_FILES_BUCKET);

  return {
    async upload({ path, bytes, contentType }) {
      const { error } = await bucket().upload(path, bytes, {
        contentType,
        // Перезапись запрещена: имя объекта — UUID, коллизий быть не должно, а
        // `upsert` позволил бы подменить уже существующий объект.
        upsert: false,
      });
      return { error: error ? { message: error.message } : null };
    },
    async remove(path) {
      const { error } = await bucket().remove([path]);
      return { error: error ? { message: error.message } : null };
    },
    async createSignedUrl({ path, expiresIn, download }) {
      // `download` — имя для `Content-Disposition: attachment`; `null` значит
      // «просмотр», и тогда параметр в Storage не передаётся вовсе.
      const { data, error } = await bucket().createSignedUrl(
        path,
        expiresIn,
        download ? { download } : undefined,
      );
      return {
        data: data?.signedUrl ? { signedUrl: data.signedUrl } : null,
        error: error ? { message: error.message } : null,
      };
    },
  };
}

/**
 * Присланное значение — файл?
 *
 * Проверяем по признаку `arrayBuffer`, а не только по `instanceof File`:
 * `FormData` в серверном действии собирается из multipart-запроса, и File там
 * может быть реализацией рантайма, а не глобального класса. Строковое значение
 * (`formData.set("file", "текст")`) отсекается.
 */
function isFileLike(value: unknown): value is File {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { arrayBuffer?: unknown }).arrayBuffer === "function" &&
    typeof (value as { size?: unknown }).size === "number" &&
    typeof (value as { type?: unknown }).type === "string"
  );
}

/** Строковое поле формы; отсутствие и пустая строка неразличимы. */
function textField(formData: FormData, name: string): string | null {
  const value = formData.get(name);
  return typeof value === "string" ? value : null;
}

/**
 * Активные файлы позиции.
 *
 * URL объектов здесь нет: ссылка на файл — отдельная операция с коротким TTL.
 */
export async function listSpecItemFiles(
  orgSlug: string,
  specItemId: string,
): Promise<ActionResult<SpecItemFileEntry[]>> {
  const { ctx, supabase, item, failed } = await resolveItem(orgSlug, specItemId);
  if (failed) return fail("Не удалось получить файлы позиции");
  if (!item) return fail("Позиция не найдена", "NOT_FOUND");

  const result = await listSpecItemFilesCore(supabase, {
    orgId: ctx.orgId,
    projectId: item.project_id,
    specItemId: item.id,
  });

  return result.ok ? ok(result.files) : toFailure(result.error);
}

/**
 * Загрузка файла.
 *
 * Из формы читаются ровно пять пользовательских значений: `file`, `category`,
 * необязательное `file_name` (переопределение имени), необязательный
 * `payment_id` (документ к оплате) и необязательный `payment_plan_id` (счёт к
 * плановому платежу). Организация, проект, позиция, путь, автор и время
 * определяются сервером; `storage_path` в контракте отсутствует, поэтому
 * подсунуть чужой объект нечем.
 *
 * Обе ссылки — исключение из правила «сервер решает сам»: они приходят от
 * клиента, но НЕ принимаются на веру — ядро читает строку оплаты и строку
 * графика, сверяя позицию, организацию и проект (`resolveFileLinks` в
 * `lib/spec/spec-item-files.ts`). Ссылок две намеренно: счёт приходит ДО денег,
 * и после отметки «Оплачено» файл получает вторую связь, не теряя первую.
 */
export async function uploadSpecItemFile(
  orgSlug: string,
  specItemId: string,
  formData: FormData,
): Promise<ActionResult<SpecItemFileEntry>> {
  const { ctx, supabase, item, failed } = await resolveItem(orgSlug, specItemId);

  // Права проверяются ДО чтения файла из формы: незачем читать в память
  // multipart тому, кому операция всё равно запрещена.
  if (!can(ctx.role, "record:create")) {
    return fail("Недостаточно прав для загрузки файлов", "FORBIDDEN");
  }

  if (failed) return fail("Не удалось загрузить файл");
  if (!item) return fail("Позиция не найдена", "NOT_FOUND");

  const file = formData.get("file");
  if (!isFileLike(file)) return fail("Файл не найден", "INVALID_INPUT");

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch (cause) {
    console.error("[uploadSpecItemFile] чтение файла", cause);
    return fail("Не удалось прочитать файл", "FAILED");
  }

  // Имя: явное поле формы имеет приоритет, иначе — имя из самого файла. Пустое
  // значение до ядра не доходит как «имя», его отдельно не подменяем: правило
  // «у файла нет имени» живёт в валидации ядра.
  const fileName = textField(formData, "file_name") ?? file.name;

  const result = await uploadSpecItemFileCore(supabase, storageOf(supabase), {
    orgId: ctx.orgId,
    projectId: item.project_id,
    specItemId: item.id,
    // Автор — из сессии, а не из формы: и идентификатор, и имя.
    uploadedBy: ctx.userId,
    uploadedByName: ctx.user.name ?? null,
    // Пустая строка и отсутствие поля одинаково означают «без оплаты» —
    // разбор и проверка живут в ядре (`resolveFileLinks`).
    paymentId: textField(formData, "payment_id"),
    // То же правило у второй ссылки: пусто — «без плана».
    paymentPlanId: textField(formData, "payment_plan_id"),
    data: {
      bytes,
      fileName,
      declaredMime: file.type,
      category: textField(formData, "category"),
    },
  });

  if (!result.ok) return toFailure(result.error);

  revalidatePath(`/${orgSlug}/projects/${item.project_id}`);
  return ok(result.file);
}

/**
 * Короткоживущий signed URL файла.
 *
 * Ни `storage_path`, ни URL от клиента не принимаются: путь читается из строки
 * БД и сверяется с ожидаемым префиксом `orgId/spec-items/specItemId/`.
 *
 * `forDownload` — намерение пользователя, а не данные файла: с ним ссылка отдаёт
 * файл вложением под его оригинальным именем, без него — открывает в браузере.
 * Имя для заголовка берёт ядро из строки (`file_name`), а не из аргумента:
 * подставлять имя из формы в `Content-Disposition` нельзя.
 */
export async function getSpecItemFileUrl(
  orgSlug: string,
  specItemId: string,
  fileId: string,
  forDownload = false,
): Promise<ActionResult<{ url: string; expiresAt: string }>> {
  const { ctx, supabase, item, failed } = await resolveItem(orgSlug, specItemId);
  if (failed) return fail("Не удалось открыть файл");
  if (!item) return fail("Позиция не найдена", "NOT_FOUND");

  // Идентификатор проверяем формой до запроса: мусорный id всё равно не найдёт
  // строку, но так в БД не уходит заведомо невалидный UUID (PostgREST ответил бы
  // ошибкой приведения типа, а не «не найдено»).
  if (!UUID_PATTERN.test(fileId)) {
    return fail("Файл не найден", "NOT_FOUND");
  }

  const result = await getSpecItemFileUrlCore(supabase, storageOf(supabase), {
    orgId: ctx.orgId,
    projectId: item.project_id,
    specItemId: item.id,
    fileId,
    download: forDownload,
    // Имя автора нужно только ответу: строку клиент обновляет именно им, и без
    // этого после открытия файла подпись автора пропала бы.
    uploadedByName: ctx.user.name ?? null,
  });

  if (!result.ok) return toFailure(result.error);
  return ok({ url: result.url, expiresAt: result.expiresAt });
}

/**
 * Подписанные ссылки на ПАЧКУ файлов: миниатюры списка за один вызов.
 *
 * ── Зачем пачка ────────────────────────────────────────────────────────────
 *
 * Клиентский диспетчер Next.js отправляет server actions по одному, поэтому
 * «двадцать картинок» через одиночную подпись — это двадцать последовательных
 * запросов из браузера. Пачка делает из них один; почему подписи внутри него
 * уходят параллельно — в докблоке ядра (`getSpecItemFileUrls`).
 *
 * ── Границы доверия ────────────────────────────────────────────────────────
 *
 * `fileIds` — клиентское значение, и оно не принимается на веру: форму
 * идентификатора проверяет ядро, а принадлежность файла позиции и организации —
 * САМА выборка (`org_id + spec_item_id + id`), а не сравнение прочитанного.
 * Чужой, удалённый или подделанный идентификатор просто не находит строку и в
 * ответ не попадает: узнать по ответу о чужой позиции нечего.
 *
 * Права здесь не проверяются намеренно — как и у одиночной подписи: это чтение,
 * а чтение в проекте правами не описывается (`lib/permissions.ts`), и доступ к
 * позиции уже ограничен организацией из сессии.
 */
export async function getSpecItemFileUrls(
  orgSlug: string,
  specItemId: string,
  fileIds: string[],
): Promise<ActionResult<SpecItemFileSignedUrl[]>> {
  const { ctx, supabase, item, failed } = await resolveItem(orgSlug, specItemId);
  if (failed) return fail("Не удалось подписать файлы");
  if (!item) return fail("Позиция не найдена", "NOT_FOUND");

  const result = await getSpecItemFileUrlsCore(supabase, storageOf(supabase), {
    orgId: ctx.orgId,
    projectId: item.project_id,
    specItemId: item.id,
    // Не массив означает клиента, а не список: у ядра контракт `string[]`, и
    // разбирать чужую форму здесь — единственное место, где она может прийти.
    fileIds: Array.isArray(fileIds) ? fileIds : [],
  });

  return result.ok ? ok(result.urls) : toFailure(result.error);
}

/**
 * Правка файла: вид документа и оригинальное имя.
 *
 * Право — `record:create`, та же граница, что у загрузки и удаления: отдельного
 * права «править файл» в матрице нет, а наблюдатель не должен уметь ничего из
 * этого. Авторство здесь не проверяется намеренно — в отличие от оплат, у файла
 * нет правила «своё правит автор, чужое — администратор»: файл позиции
 * принадлежит позиции, а не загрузившему его человеку, и команда работает с ним
 * как с общим.
 *
 * Из формы берутся только два поля: `category` и `file_name`. Пустое значение
 * поля означает «не менять» — так форма может отправить только то, что
 * действительно правится, и не затирать второе поле пустотой.
 */
export async function updateSpecItemFile(
  orgSlug: string,
  specItemId: string,
  fileId: string,
  formData: FormData,
): Promise<ActionResult<{ file: SpecItemFileEntry; changed: boolean }>> {
  const { ctx, supabase, item, failed } = await resolveItem(orgSlug, specItemId);

  if (!can(ctx.role, "record:create")) {
    return fail("Недостаточно прав для правки файлов", "FORBIDDEN");
  }

  if (failed) return fail("Не удалось сохранить файл");
  if (!item) return fail("Позиция не найдена", "NOT_FOUND");

  if (!UUID_PATTERN.test(fileId)) {
    return fail("Файл не найден", "NOT_FOUND");
  }

  const result = await updateSpecItemFileCore(supabase, {
    orgId: ctx.orgId,
    projectId: item.project_id,
    specItemId: item.id,
    fileId,
    category: textField(formData, "category"),
    fileName: textField(formData, "file_name"),
    // Имя автора — из сессии и только для ответа: в БД его нет, а строка
    // обновляется записью сервера, поэтому иначе подпись автора пропадала бы.
    uploadedByName: ctx.user.name ?? null,
  });

  if (!result.ok) return toFailure(result.error);

  revalidatePath(`/${orgSlug}/projects/${item.project_id}`);
  return ok({ file: result.file, changed: result.changed });
}

/**
 * Мягкое удаление файла.
 *
 * Повторный вызов безопасен: строка уже удалена → Storage не трогаем, но ответ
 * тот же успешный. Право — `record:create`, как и у загрузки: отдельного права
 * на удаление файла в матрице нет, а наблюдатель не должен уметь ни то, ни другое.
 */
export async function deleteSpecItemFile(
  orgSlug: string,
  specItemId: string,
  fileId: string,
): Promise<ActionResult<{ deleted: boolean }>> {
  const { ctx, supabase, item, failed } = await resolveItem(orgSlug, specItemId);

  if (!can(ctx.role, "record:create")) {
    return fail("Недостаточно прав для удаления файлов", "FORBIDDEN");
  }

  if (failed) return fail("Не удалось удалить файл");
  if (!item) return fail("Позиция не найдена", "NOT_FOUND");

  if (!UUID_PATTERN.test(fileId)) {
    return fail("Файл не найден", "NOT_FOUND");
  }

  const result = await deleteSpecItemFileCore(supabase, storageOf(supabase), {
    orgId: ctx.orgId,
    projectId: item.project_id,
    specItemId: item.id,
    fileId,
  });

  if (!result.ok) return toFailure(result.error);

  revalidatePath(`/${orgSlug}/projects/${item.project_id}`);
  return ok({ deleted: result.deleted });
}
