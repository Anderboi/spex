/**
 * Редактирование и мягкое удаление комментария Activity Feed.
 *
 * ── Почему отдельный модуль, а не продолжение `./comment-write` ────────────
 *
 * `comment-write` отвечает за РОЖДЕНИЕ записи (вставка, ветка, optimistic-
 * подготовка) и целиком построен вокруг `INSERT`. Здесь наоборот: строка уже
 * есть, и менять в ней разрешено ровно два поля. Общий у них — домен и mapper,
 * а не код, поэтому рядом, но не вместе.
 *
 * ── Порядок проверок ──────────────────────────────────────────────────────
 *
 * 1. строка есть в этой организации и этой позиции (иначе `NOT_FOUND`);
 * 2. автор — текущий пользователь (иначе `FORBIDDEN`) — тот же предикат, что в
 *    RLS-политике;
 * 3. комментарий не удалён (иначе `INVALID_INPUT`);
 * 4. только теперь проверяется текст (иначе `INVALID_INPUT`).
 *
 * Порядок не косметический: он не даёт по коду ответа узнать о чужом
 * комментарии ничего, кроме «его нет в этой позиции и организации».
 *
 * ── Атомарность ───────────────────────────────────────────────────────────
 *
 * Изменяющий запрос — ОДИН `UPDATE`, и защита от гонки живёт в его условии
 * (`deleted_at is null`): удаление, случившееся между чтением и записью,
 * отменит правку. События в `spec_item_events` не пишутся, новых `kind` нет:
 * комментарий — самостоятельная запись Activity Feed, и вторая запись описывала
 * бы то же самое дважды.
 *
 * ── Домен и чтение ────────────────────────────────────────────────────────
 *
 * Возвращаемая запись собирается ТЕМ ЖЕ `mapSpecItemComment`, что и лента при
 * чтении, из ФАКТИЧЕСКИ обновлённой строки. Отдельной mutation-модели нет,
 * поэтому результат операции и то, что покажет следующий `getSpecItemActivity`,
 * — один и тот же домен по построению.
 *
 * ── Почему удаление не скрывает `body` ────────────────────────────────────
 *
 * Скрывать текст удалённого комментария — правило ОТОБРАЖЕНИЯ, и оно уже живёт
 * в одном месте: рендерер (`ActivityComment` / `ActivityReply`) и
 * `activityQuoteText` показывают «Комментарий удалён» по флагу `deleted`, а
 * родитель ветки остаётся в ленте как плейсхолдер. Если бы мутация вычищала
 * `body`, она разошлась бы с чтением — а требование обратное: результат мутации
 * обязан совпадать с read-layer'ом для той же строки. Поэтому `body`
 * возвращается как в БД, а видимость текста решает отображение.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../types";
import { mapSpecItemComment } from "./history-mappers";
import type { HistoryCommentEntry } from "./history-types";
import { createCommentSchema } from "../validations";

/** Клиент БД: как у остальных слоёв записи, приходит аргументом. */
export type CommentMutateDb = SupabaseClient<Database>;

/** Причина отказа, которую action превращает в `ActionResult`. */
export type CommentMutationError = {
  code: "FORBIDDEN" | "NOT_FOUND" | "INVALID_INPUT" | "FAILED";
  message: string;
};

export type CommentMutationResult =
  | { ok: true; comment: HistoryCommentEntry }
  | { ok: false; error: CommentMutationError };

/** Кто выполняет операцию: права проверяются по этому id. */
export type CommentMutationActor = {
  id: string;
};

/**
 * Колонки записи — тот же список, что у чтения ленты.
 *
 * Литерал обязателен: только по нему supabase-js выводит тип строки.
 * Совпадение с `HISTORY_COMMENT_COLUMNS` проверяет тест контракта.
 */
const COMMENT_COLUMNS =
  "id, org_id, spec_item_id, parent_id, root_id, author_id, author_name_snapshot, body, created_at, edited_at, deleted_at";

/** Строка комментария в объёме, который нужен операциям. */
type CommentRow = {
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
};

/** Общая часть входа: какую строку и от чьего имени меняем. */
type TargetInput = {
  orgId: string;
  specItemId: string;
  commentId: string;
  actor: CommentMutationActor;
};

/**
 * Право на изменение комментария.
 *
 * Правило — «только автор», и оно не выдумано здесь: так устроены RLS-политики
 * `spec_item_comments_update_author` и `spec_item_comments_delete_author`
 * (миграция `20260918_001`), где `using (author_id = auth.uid())`. Миграция
 * отдельно оговаривает, что матрица прав на комментарии ещё не определена и
 * роли admin/owner сюда намеренно не заложены. Приложение ходит service-role и
 * RLS обходит, поэтому проверка повторена в коде — тем же предикатом, без
 * второй системы прав.
 */
export function canEditComment(args: {
  actor: CommentMutationActor;
  comment: { authorId: string | null };
}): boolean {
  return (
    args.comment.authorId !== null && args.comment.authorId === args.actor.id
  );
}

/** Найти строку и убедиться, что менять её вообще можно. */
async function resolveTarget(
  db: CommentMutateDb,
  input: TargetInput,
): Promise<
  { ok: true; row: CommentRow } | { ok: false; error: CommentMutationError }
> {
  const { data, error } = await db
    .from("spec_item_comments")
    .select(COMMENT_COLUMNS)
    .eq("id", input.commentId)
    .eq("org_id", input.orgId)
    .eq("spec_item_id", input.specItemId)
    .maybeSingle();

  if (error) {
    console.error("[resolveTarget]", error.message);
    return {
      ok: false,
      error: { code: "FAILED", message: "Не удалось сохранить комментарий" },
    };
  }

  // Чужой комментарий (другая организация или другая позиция) сюда не попадает:
  // о его существовании вызывающий не узнаёт ничего.
  if (!data) {
    return {
      ok: false,
      error: { code: "NOT_FOUND", message: "Комментарий не найден" },
    };
  }

  if (
    !canEditComment({
      actor: input.actor,
      comment: { authorId: data.author_id },
    })
  ) {
    return {
      ok: false,
      error: {
        code: "FORBIDDEN",
        message: "Можно изменять только свои комментарии",
      },
    };
  }

  // Удалённый комментарий остаётся в ленте плейсхолдером, но не является
  // предметом обсуждения: ни правки, ни повторного удаления.
  if (data.deleted_at !== null) {
    return {
      ok: false,
      error: { code: "INVALID_INPUT", message: "Комментарий удалён" },
    };
  }

  return { ok: true, row: data };
}

/** Ответов на комментарий — одним запросом, как в read-layer'е. */
async function countReplies(
  db: CommentMutateDb,
  row: CommentRow,
): Promise<number> {
  const { data, error } = await db
    .from("spec_item_comments")
    .select("id")
    .eq("org_id", row.org_id)
    .eq("spec_item_id", row.spec_item_id)
    .eq("parent_id", row.id);

  if (error) {
    // Ошибка счётчика не роняет операцию: строка уже изменена, а счётчик —
    // вторичные данные. Тем же приёмом это делает `getSpecItemHistory`.
    console.error("[countReplies]", error.message);
    return 0;
  }
  return (data ?? []).length;
}

/** Фактически обновлённая строка → домен, с честным числом ответов. */
async function toEntry(
  db: CommentMutateDb,
  row: CommentRow,
): Promise<HistoryCommentEntry> {
  return mapSpecItemComment(row, await countReplies(db, row));
}

/**
 * Отредактировать текст комментария или ответа.
 *
 * Меняются ровно два поля: `body` (проверенный тем же правилом, что при
 * создании) и `edited_at` — серверная метка. `created_at`, автор и снимок имени,
 * `parent_id`, `root_id` и `deleted_at` не входят в `UPDATE` вообще, поэтому
 * «изменить» их этим вызовом невозможно: в типе входа нет соответствующих полей.
 */
export async function editSpecItemComment(
  db: CommentMutateDb,
  input: TargetInput & { body: string },
): Promise<CommentMutationResult> {
  const target = await resolveTarget(db, input);
  if (!target.ok) return { ok: false, error: target.error };

  // То же правило текста, что при создании: второй копии ограничений нет.
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

  const editedAt = new Date().toISOString();

  const { data, error } = await db
    .from("spec_item_comments")
    .update({ body: parsed.data.body, edited_at: editedAt })
    .eq("id", input.commentId)
    .eq("org_id", input.orgId)
    .eq("spec_item_id", input.specItemId)
    // Защита от гонки: удаление между чтением и записью отменяет правку.
    .is("deleted_at", null)
    .select(COMMENT_COLUMNS)
    .maybeSingle();

  if (error) {
    console.error("[editSpecItemComment]", error.message);
    return {
      ok: false,
      error: { code: "FAILED", message: "Не удалось сохранить комментарий" },
    };
  }

  if (!data) {
    return {
      ok: false,
      error: { code: "INVALID_INPUT", message: "Комментарий удалён" },
    };
  }

  return { ok: true, comment: await toEntry(db, data) };
}

/**
 * Мягко удалить комментарий: `deleted_at` ставит сервер.
 *
 * Строка не удаляется физически, поэтому комментарий остаётся в ленте со своим
 * `id`, временем, автором и веткой, а ветка ответов не рушится: FK на
 * `parent_id` сработал бы только при физическом удалении. Повторный вызов
 * находит `deleted_at is not null` и отвечает «удалён» — поведение
 * определённое, без второго изменения строки.
 */
export async function deleteSpecItemComment(
  db: CommentMutateDb,
  input: TargetInput,
): Promise<CommentMutationResult> {
  const target = await resolveTarget(db, input);
  if (!target.ok) return { ok: false, error: target.error };

  const { data, error } = await db
    .from("spec_item_comments")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", input.commentId)
    .eq("org_id", input.orgId)
    .eq("spec_item_id", input.specItemId)
    .is("deleted_at", null)
    .select(COMMENT_COLUMNS)
    .maybeSingle();

  if (error) {
    console.error("[deleteSpecItemComment]", error.message);
    return {
      ok: false,
      error: { code: "FAILED", message: "Не удалось удалить комментарий" },
    };
  }

  if (!data) {
    return {
      ok: false,
      error: { code: "INVALID_INPUT", message: "Комментарий удалён" },
    };
  }

  return { ok: true, comment: await toEntry(db, data) };
}
