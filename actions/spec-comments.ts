"use server";

import { revalidatePath } from "next/cache";
import { requireOrgBySlug } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { can } from "@/lib/permissions";
import { fail, ok, type ActionResult } from "@/lib/action-result";
import {
  deleteSpecItemComment as deleteComment,
  editSpecItemComment as editComment,
  type CommentMutationError,
} from "@/lib/spec/comment-mutate";
import {
  recordSpecItemComment,
  type CreateCommentError,
} from "@/lib/spec/comment-write";
import { eventActorOf } from "@/lib/spec/history";
import type { HistoryCommentEntry } from "@/lib/spec/history-types";

/**
 * Комментарии Activity Feed: создание, правка и мягкое удаление.
 *
 * ── Граница слоя ───────────────────────────────────────────────────────────
 *
 * Здесь только то, чего не может ядро (`lib/spec/comment-write.ts`,
 * `lib/spec/comment-mutate.ts`): сессия, `orgSlug` → `orgId`, проверка
 * принадлежности позиции организации и перевод результата в `ActionResult`.
 * Сами запросы, правила текста и выбор ветки — в ядре, и именно поэтому они
 * покрыты unit-тестами без Next.
 *
 * ── Кто что может ─────────────────────────────────────────────────────────
 *
 * * создать комментарий — участник организации с правом записи
 *   (`can(role, "record:create")`, наблюдатель отсекается: та же граница, что у
 *   RLS-политики `spec_item_comments_insert_member`);
 * * изменить и удалить — только автор записи (см. `canEditComment` в
 *   `comment-mutate`: ровно то же условие, что в RLS-политиках
 *   `spec_item_comments_update_author` / `_delete_author`).
 *
 * ── Проверка позиции ──────────────────────────────────────────────────────
 *
 * `resolveItem` повторяет её для всех трёх операций: позиция обязана быть в
 * организации из сессии и не быть удалённой. Своей проверки организации не
 * заводится — её делает `requireOrgBySlug`.
 */
async function resolveItem(orgSlug: string, specItemId: string) {
  const ctx = await requireOrgBySlug(orgSlug);
  const supabase = createAdminClient();

  // Позиция проверяется по организации из сессии, а не по аргументу: чужой id
  // не даёт ни комментария, ни сведения о том, существует ли он. Удалённая
  // позиция тоже не комментируется — её карточка закрыта.
  const { data: item, error } = await supabase
    .from("spec_items")
    .select("id, project_id, org_id")
    .eq("id", specItemId)
    .eq("org_id", ctx.orgId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) {
    // Причину отказа пользователю не показываем: текст ошибки БД — внутренняя
    // деталь, а для UI это «не удалось».
    console.error("[spec-comments] item", error.message);
    return { ctx, supabase, item: null, failed: true as const };
  }

  return { ctx, supabase, item, failed: false as const };
}

/**
 * Создание комментария или ответа.
 *
 * Из mutation input приходят ровно два пользовательских значения: `body` и
 * `parentId`. `orgId`, автор, его снимок имени, `createdAt` и `rootId`
 * определяются сервером.
 *
 * Отдельной строки в `spec_item_events` не создаётся: комментарий и есть запись
 * Activity Feed, поэтому атомарен сам INSERT.
 */
export async function createSpecItemComment(
  orgSlug: string,
  specItemId: string,
  input: { body: string; parentId?: string | null },
): Promise<ActionResult<HistoryCommentEntry>> {
  const { ctx, supabase, item, failed } = await resolveItem(orgSlug, specItemId);

  // Граница та же, что у RLS-политики `spec_item_comments_insert_member`
  // (наблюдателя она не пропускает): право создания записи, минимум member.
  // Приложению клиент приходит service-role и RLS обходит, поэтому проверка
  // обязана стоять здесь.
  if (!can(ctx.role, "record:create")) {
    return fail("Недостаточно прав для комментирования", "FORBIDDEN");
  }

  if (failed) return fail("Не удалось создать комментарий");
  if (!item) return fail("Позиция не найдена", "NOT_FOUND");

  const result = await recordSpecItemComment(supabase, {
    orgId: ctx.orgId,
    specItemId: item.id,
    // Автор — из сессии, тем же хелпером, что и события истории: снимок имени
    // у комментария и у события считается ровно по одному правилу.
    author: eventActorOf(ctx),
    body: input.body,
    parentId: input.parentId ?? null,
  });

  if (!result.ok) {
    // Код отказа переносится как есть: ядро уже решило, ошибка это ввода,
    // недоступный родитель или отказ доступа, — а UI различает эти случаи.
    const { code, message }: CreateCommentError = result.error;
    return fail(message, code);
  }

  revalidatePath(`/${orgSlug}/projects/${item.project_id}`);
  return ok(result.comment);
}

/**
 * Правка текста комментария или ответа.
 *
 * Меняются только `body` и `edited_at` (серверная метка): время создания, автор,
 * снимок имени, ветка и признак удаления не входят в `UPDATE`. Право — только у
 * автора, и решает это ядро по строке из БД.
 */
export async function updateSpecItemComment(
  orgSlug: string,
  specItemId: string,
  commentId: string,
  input: { body: string },
): Promise<ActionResult<HistoryCommentEntry>> {
  const { ctx, supabase, item, failed } = await resolveItem(orgSlug, specItemId);
  if (failed) return fail("Не удалось сохранить комментарий");
  if (!item) return fail("Позиция не найдена", "NOT_FOUND");

  const result = await editComment(supabase, {
    orgId: ctx.orgId,
    specItemId: item.id,
    commentId,
    actor: { id: ctx.userId },
    body: input.body,
  });

  if (!result.ok) {
    const { code, message }: CommentMutationError = result.error;
    return fail(message, code);
  }

  revalidatePath(`/${orgSlug}/projects/${item.project_id}`);
  return ok(result.comment);
}

/**
 * Мягкое удаление комментария или ответа.
 *
 * Физически строка не удаляется: ставится `deleted_at`, поэтому комментарий
 * остаётся в ленте со своей веткой, а ответы на него не пропадают. Право — у
 * автора.
 */
export async function deleteSpecItemComment(
  orgSlug: string,
  specItemId: string,
  commentId: string,
): Promise<ActionResult<HistoryCommentEntry>> {
  const { ctx, supabase, item, failed } = await resolveItem(orgSlug, specItemId);
  if (failed) return fail("Не удалось удалить комментарий");
  if (!item) return fail("Позиция не найдена", "NOT_FOUND");

  const result = await deleteComment(supabase, {
    orgId: ctx.orgId,
    specItemId: item.id,
    commentId,
    actor: { id: ctx.userId },
  });

  if (!result.ok) {
    const { code, message }: CommentMutationError = result.error;
    return fail(message, code);
  }

  revalidatePath(`/${orgSlug}/projects/${item.project_id}`);
  return ok(result.comment);
}
