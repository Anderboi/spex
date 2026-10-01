/**
 * Создание комментария Activity Feed: ядро mutation без сессии и без Next.
 *
 * ── Почему отдельный модуль ────────────────────────────────────────────────
 *
 * Ровно по той же причине, по которой существует `./history-read`: сессия,
 * `orgSlug` → `orgId` и форма ответа для клиента живут в server action
 * (`actions/spec-comments.ts`), а проверки принадлежности, выбор корня ветки и
 * сама вставка — здесь, куда клиент БД приходит аргументом (DI, как в
 * `recordSpecItemEvent`). Так контракт создания проверяется unit-тестами на
 * подставном клиенте, без Next и без живой БД.
 *
 * ── Глубина обсуждения ────────────────────────────────────────────────────
 *
 * В интерфейсе поддержано ровно два уровня: корневой комментарий и ответ.
 * Схема это допускает шире (`parent_id` ссылается сам на себя, `root_id` —
 * логическая связь без FK), поэтому границу держит код:
 *
 *   * ответ на корень  → `parent_id` = корень, `root_id` = корень;
 *   * ответ на ответ   → `parent_id` = КОРЕНЬ ветки, `root_id` = корень.
 *
 * Второй случай — не «третий уровень» и не отказ: пользователь отвечает в той
 * же ветке, и ветка остаётся плоской. Это ровно та модель, которую уже
 * отображает read-layer: `ActivityComment` показывает корень и его ответы одним
 * уровнем, а ответ на ответ попадает в тот же список. Отклонять такой ввод
 * значило бы запретить жест, который пользователь считает обычным ответом, и
 * потерять его текст.
 *
 * ── Транзакционность ──────────────────────────────────────────────────────
 *
 * Создание комментария — ОДИН INSERT, и он атомарен сам по себе. Отдельного
 * события в `spec_item_events` здесь нет намеренно: комментарий уже является
 * записью Activity Feed (`HistoryCommentEntry`), и вторая запись описывала бы
 * то же самое дважды. Схема это подтверждает: `spec_item_comments` — отдельная
 * таблица пользовательского контента, а не журнал событий, и в доменном
 * контракте у неё собственный `source: "comment"`.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, TablesInsert } from "../types";
import { actorNameSnapshot, type SpecItemEventActor } from "./history";
import type { HistoryCommentEntry } from "./history-types";
import { COMMENT_LIMITS, createCommentSchema } from "../validations";

/**
 * Клиент БД: как у остальных слоёв, приходит аргументом. Серверный action
 * передаёт сюда service-role клиент, который RLS обходит, поэтому правила
 * доступа повторены в коде (см. `actions/spec-comments.ts`) — политика
 * `spec_item_comments_insert_member` остаётся вторым контуром для Data API.
 */
export type CommentWriteDb = SupabaseClient<Database>;

/**
 * Автор комментария.
 *
 * Это ТОТ ЖЕ тип, что у событий истории (`SpecItemEventActor`): снимок автора у
 * комментария и у события — одно правило, и заводить второй тип с теми же
 * полями значило бы позволить им разойтись.
 */
export type CommentAuthor = SpecItemEventActor;

/** Причина отказа, которую action превращает в `ActionResult`. */
export type CreateCommentError = {
  code: "FORBIDDEN" | "NOT_FOUND" | "INVALID_PARENT" | "INVALID_INPUT" | "FAILED";
  message: string;
};

export type CreateCommentResult =
  | { ok: true; comment: HistoryCommentEntry }
  | { ok: false; error: CreateCommentError };

/** Вход ядра: всё уже разрешено вызывающим, кроме проверок принадлежности. */
export type CreateCommentInput = {
  orgId: string;
  specItemId: string;
  /** Автор из сессии. Ни `authorId`, ни имя клиент не присылает. */
  author: CommentAuthor;
  /** Пользовательский текст: единственные данные, которые приходят извне. */
  body: string;
  /** Ответ на комментарий; `null` — корневой комментарий. */
  parentId?: string | null;
};

/** Колонки, которые реально нужны для доменного `HistoryCommentEntry`. */
const COMMENT_COLUMNS =
  "id, org_id, spec_item_id, parent_id, root_id, author_id, author_name_snapshot, body, created_at, edited_at, deleted_at";

/** Строка комментария в том виде, в каком её вернул PostgREST. */
function toCommentRow(
  input: CreateCommentInput,
  body: string,
  ids: { parentId: string | null; rootId: string | null },
  createdAt: string,
): TablesInsert<"spec_item_comments"> {
  return {
    org_id: input.orgId,
    spec_item_id: input.specItemId,
    parent_id: ids.parentId,
    root_id: ids.rootId,
    // Автор и время определяются сервером: из mutation input они не приходят.
    // Снимок имени считает тот же `actorNameSnapshot`, что у событий истории.
    author_id: input.author.id,
    author_name_snapshot: actorNameSnapshot(input.author),
    body,
    created_at: createdAt,
  };
}

/** Родитель, как его отдаёт выборка: нужны `parent_id`, `root_id` и факт удаления. */
type ParentRow = {
  id: string;
  parent_id: string | null;
  root_id: string | null;
  deleted_at: string | null;
};

/**
 * Выбор ветки для нового комментария.
 *
 * Родитель читается одним запросом и сразу с проверками: он должен быть жив
 * (не soft-deleted), из той же организации и той же позиции. Проверка позиции
 * здесь не формальность: без неё ответ можно было бы привязать к комментарию
 * другой позиции, и `parent_id`-FK такую связь пропустил бы — он смотрит
 * только на таблицу комментариев.
 */
async function resolveThread(
  db: CommentWriteDb,
  input: CreateCommentInput,
): Promise<
  | { ok: true; parentId: string | null; rootId: string | null }
  | { ok: false; error: CreateCommentError }
> {
  const parentId = input.parentId ?? null;
  if (!parentId) return { ok: true, parentId: null, rootId: null };

  const { data, error } = await db
    .from("spec_item_comments")
    .select("id, parent_id, root_id, deleted_at")
    .eq("id", parentId)
    .eq("org_id", input.orgId)
    .eq("spec_item_id", input.specItemId)
    .maybeSingle<ParentRow>();

  if (error) {
    // Причину отказа пользователю не показываем: текст ошибки БД — внутренняя
    // деталь, а для UI это «не удалось создать комментарий».
    console.error("[recordSpecItemComment] parent", error.message);
    return {
      ok: false,
      error: { code: "INVALID_PARENT", message: "Не удалось создать комментарий" },
    };
  }

  // Родителя нет в этой позиции и этой организации, либо он мягко удалён:
  // ветку продолжать не на чем — удалённый родитель остался в ленте только
  // как плейсхолдер, а не как точка обсуждения.
  if (!data || data.deleted_at !== null) {
    return {
      ok: false,
      error: {
        code: "INVALID_PARENT",
        message: "Комментарий, на который вы отвечаете, недоступен",
      },
    };
  }

  // Ответ на корень: ветка — сам корень.
  if (!data.parent_id) {
    return { ok: true, parentId: data.id, rootId: data.id };
  }

  // Ответ на ответ: ветка остаётся плоской, корнем становится корень родителя.
  // `root_id` мог не записаться исторической строкой — тогда корень и есть
  // непосредственный родитель.
  const rootId = data.root_id ?? data.parent_id;
  return { ok: true, parentId: rootId, rootId };
}

/**
 * Создать комментарий или ответ.
 *
 * Ничего не читает из сессии и не проверяет правами организации — это делает
 * server action. Здесь ровно то, что относится к самому комментарию: валидация
 * текста, выбор ветки и атомарная вставка.
 *
 * Имя по образцу `recordSpecItemEvent` из `./history`: тот же слой записи,
 * один и тот же порядок «проверить → записать → вернуть записанное».
 */
export async function recordSpecItemComment(
  db: CommentWriteDb,
  input: CreateCommentInput,
): Promise<CreateCommentResult> {
  // Валидация серверная и единственная: клиентской проверке здесь не доверяют,
  // `trim` выполняется до `min(1)`, поэтому пробельный текст не проходит.
  const parsed = createCommentSchema.safeParse({ body: input.body });
  if (!parsed.success) {
    return {
      ok: false,
      error: {
        code: "INVALID_INPUT",
        message: parsed.error.issues[0].message,
      },
    };
  }

  const thread = await resolveThread(db, input);
  if (!thread.ok) return { ok: false, error: thread.error };

  // Время ставит сервер, и оно же возвращается клиенту: тогда оптимистичная
  // запись в ленте окажется ровно той, что лежит в БД (никакого расхождения
  // в микросекундах между ответом и следующим чтением).
  const createdAt = new Date().toISOString();

  const { data, error } = await db
    .from("spec_item_comments")
    .insert(toCommentRow(input, parsed.data.body, thread, createdAt))
    .select(COMMENT_COLUMNS)
    .single();

  if (error || !data) {
    console.error("[recordSpecItemComment]", error?.message ?? "нет строки");
    // Отказ БД — это не ошибка ввода: текст корректен, значит UI должен
    // показать «не удалось», а не подсветить поле.
    return {
      ok: false,
      error: { code: "FAILED", message: "Не удалось создать комментарий" },
    };
  }

  // Ответ строится из ФАКТИЧЕСКИ записанной строки, а не из входных данных:
  // только она подтверждает, что сохранилось именно это.
  return { ok: true, comment: rowToCommentEntry(data) };
}

/**
 * Строка БД → доменный `HistoryCommentEntry`.
 *
 * `replyCount` у только что созданного комментария всегда `0`: ответов у него
 * ещё нет, а считает их read-layer по всей позиции. `editedAt`/`deleted`
 * берутся из строки, а не из предположения.
 *
 * Тот же смысл, что у `mapSpecItemComment` из `./history-mappers`, но вход —
 * не `Tables<"spec_item_comments">` целиком (в ответе только выбранные
 * колонки), поэтому используется локальное преобразование. Обе функции
 * обязаны давать одинаковый домен: контракт между ними закреплён тестом.
 */
function rowToCommentEntry(row: {
  id: string;
  org_id: string;
  spec_item_id: string;
  parent_id: string | null;
  root_id: string | null;
  author_id: string | null;
  author_name_snapshot: string | null;
  body: string;
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
}): HistoryCommentEntry {
  const name = row.author_name_snapshot;
  return {
    id: row.id,
    orgId: row.org_id,
    specItemId: row.spec_item_id,
    createdAt: row.created_at,
    actor: {
      id: row.author_id,
      // Пустая строка — то же «не заполнено», что и `null`: подставлять текст
      // вместо отсутствующих данных контракт не должен.
      name: typeof name === "string" && name.length > 0 ? name : null,
    },
    source: "comment",
    parentId: row.parent_id,
    rootId: row.root_id,
    body: row.body,
    // Отсутствие метки — то же «не изменялся / не удалён», что и `null`:
    // `undefined` здесь значил бы «удалён», то есть ровно наоборот.
    editedAt: row.edited_at ?? null,
    deleted: (row.deleted_at ?? null) !== null,
    replyCount: 0,
  };
}

/** Пределы текста комментария — для UI и для тестов. */
export { COMMENT_LIMITS };

/* ------------------------------------------------------------------ */
/*  Подготовка отправки (общая для UI и проверок)                      */
/* ------------------------------------------------------------------ */

export type ComposerBodyCheck =
  | { ok: true; body: string }
  | { ok: false; message: string };

/**
 * Готов ли текст к отправке.
 *
 * Та же схема, что применяет сервер (`createCommentSchema`), но здесь она нужна
 * ДО запроса: пустой и пробельный текст не отправляется вовсе, а не гоняет
 * round-trip ради отказа. Клиентская проверка не заменяет серверную — сервер
 * проверяет текст ещё раз и остаётся источником истины.
 */
export function checkComposerBody(raw: string): ComposerBodyCheck {
  const parsed = createCommentSchema.safeParse({ body: raw });
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0].message };
  }
  return { ok: true, body: parsed.data.body };
}

/**
 * Префикс временного идентификатора optimistic-записи.
 *
 * Явно клиентский: сервер выдаёт UUID, поэтому такая строка не может совпасть с
 * настоящим `id` и не уедет на сервер (в mutation input уходит только `body` и
 * `parentId`). Нужен ровно для `key` в списке и для поиска записи при замене.
 */
const OPTIMISTIC_ID_PREFIX = "optimistic:";

export function optimisticCommentId(): string {
  return `${OPTIMISTIC_ID_PREFIX}${globalThis.crypto.randomUUID()}`;
}

/** Клиентская ли это запись (только для отображения, ещё не подтверждена). */
export function isOptimisticCommentId(id: string): boolean {
  return id.startsWith(OPTIMISTIC_ID_PREFIX);
}

/**
 * Временная запись для мгновенного отображения: показывается, пока идёт запрос,
 * и заменяется серверным `HistoryCommentEntry` после успеха.
 *
 * Собирается из того, что уже известно на клиенте (текст, автор, ветка), и НЕ
 * считается окончательным комментарием: `id` помечен как клиентский, а
 * `replyCount` равен нулю. Серверные значения (`id`, `createdAt`, снимок имени)
 * приходят ответом и имеют приоритет.
 */
export function buildOptimisticComment(args: {
  orgId: string;
  specItemId: string;
  author: { id: string | null; name: string | null };
  body: string;
  /** Комментарий, на который отвечают: `null` — корневой. */
  parent: { id: string; parentId: string | null; rootId: string | null } | null;
  /** Время optimistic-записи: по нему она встаёт в конец ветки. */
  createdAt: string;
  id?: string;
}): HistoryCommentEntry {
  // Ветка выводится из той же модели, что и на сервере: ответ на корень —
  // корнем ветки, ответ на ответ — корнем остаётся корень родителя.
  const rootId = args.parent
    ? (args.parent.parentId ?? args.parent.id)
    : null;

  return {
    id: args.id ?? optimisticCommentId(),
    orgId: args.orgId,
    specItemId: args.specItemId,
    createdAt: args.createdAt,
    actor: { id: args.author.id, name: args.author.name },
    source: "comment",
    parentId: args.parent ? args.parent.id : null,
    rootId,
    body: args.body,
    editedAt: null,
    deleted: false,
    // Ответов у только что отправленного комментария ещё нет: сервер посчитает
    // их сам при следующем чтении.
    replyCount: 0,
  };
}
