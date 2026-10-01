"use server";

import { revalidatePath } from "next/cache";
import { requireOrgBySlug } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { can } from "@/lib/permissions";
import { fail, ok, type ActionResult } from "@/lib/action-result";
import {
  recordSpecItemComment,
  type CreateCommentError,
} from "@/lib/spec/comment-write";
import { eventActorOf } from "@/lib/spec/history";
import type { HistoryCommentEntry } from "@/lib/spec/history-types";

/**
 * Создание комментария или ответа в Activity Feed позиции.
 *
 * ── Что делает этот файл ───────────────────────────────────────────────────
 *
 * Только то, чего не может ядро записи (`lib/spec/comment-write.ts`): читает
 * сессию, превращает `orgSlug` в `orgId`, проверяет права и принадлежность
 * позиции, решает, показывать ли ошибку БД, и переводит результат в
 * `ActionResult`. Сама вставка, валидация текста и выбор корня ветки — там, и
 * именно поэтому они покрыты unit-тестами без Next.
 *
 * ── Почему список параметров такой узкий ───────────────────────────────────
 *
 * Из mutation input приходят ровно два пользовательских значения: `body` и
 * `parentId`. `orgId`, автор, его снимок имени, `createdAt` и `rootId`
 * определяются сервером — клиент не может подписать комментарий чужим именем,
 * задним числом или привязать ветку к чужой записи.
 *
 * ── Почему одной вставки достаточно ────────────────────────────────────────
 *
 * Комментарий и есть запись Activity Feed (`HistoryCommentEntry`), отдельной
 * строки в `spec_item_events` для него не создаётся: в доменном контракте у
 * комментария собственный `source: "comment"`, а в схеме — собственная таблица
 * пользовательского контента. Дублировать его событием значило бы описывать
 * одно действие дважды, поэтому и транзакция здесь не нужна: атомарен сам
 * INSERT.
 */
export async function createSpecItemComment(
  orgSlug: string,
  specItemId: string,
  input: { body: string; parentId?: string | null },
): Promise<ActionResult<HistoryCommentEntry>> {
  // `requireOrgBySlug` — существующий механизм доступа: он и 404 на чужой slug
  // даёт, и возвращает роль. Своей проверки организации здесь не заводится.
  const ctx = await requireOrgBySlug(orgSlug);

  // Граница та же, что у RLS-политики `spec_item_comments_insert_member`
  // (наблюдателя она не пропускает): право создания записи, минимум member.
  // Приложению клиент приходит service-role и RLS обходит, поэтому проверка
  // обязана стоять здесь.
  if (!can(ctx.role, "record:create")) {
    return fail("Недостаточно прав для комментирования", "FORBIDDEN");
  }

  const supabase = createAdminClient();

  // Позиция проверяется по организации из сессии, а не по аргументу: чужой id
  // не даёт ни комментария, ни сведения о том, существует ли он. Удалённая
  // позиция тоже не комментируется — её карточка закрыта.
  const { data: item, error: itemError } = await supabase
    .from("spec_items")
    .select("id, project_id, org_id")
    .eq("id", specItemId)
    .eq("org_id", ctx.orgId)
    .is("deleted_at", null)
    .maybeSingle();

  if (itemError) {
    console.error("[createSpecItemComment] item", itemError.message);
    return fail("Не удалось создать комментарий");
  }
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

  // Лента активности изменена — обновляем те страницы, где она читается.
  // Комментарий не меняет саму спецификацию, поэтому путь только один.
  revalidatePath(`/${orgSlug}/projects/${item.project_id}`);

  return ok(result.comment);
}
