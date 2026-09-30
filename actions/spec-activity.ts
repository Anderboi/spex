"use server";

import { requireOrgBySlug } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { fail, ok, type ActionResult } from "@/lib/action-result";
import { getSpecItemHistory } from "@/lib/spec/history-read";
import {
  ACTIVITY_PAGE_SIZE,
  type ActivityCursor,
  type ActivityFeedPage,
} from "@/lib/spec/activity-types";

/**
 * Страница ленты активности позиции: события и комментарии одной хронологией.
 *
 * Только чтение: mutation-событий здесь нет и не будет, запись истории живёт в
 * `lib/spec/history.ts` и вызывается из actions, которые действительно меняют
 * данные.
 *
 * Сам запрос — не здесь: `getSpecItemHistory` (`lib/spec/history-read.ts`)
 * раскладывает порядок, объединяет две таблицы и считает курсор. Этот файл
 * добавляет ровно то, чего в read-layer'е быть не может: сессию, проверку
 * принадлежности позиции организации и форму ответа для клиента.
 *
 * ── Почему результат, а не исключение ──────────────────────────────────────
 *
 * Ошибку нужно показать в UI вместе с кнопкой «Повторить», а не уронить
 * вкладку: клиент различает «нет записей» и «не удалось прочитать». Поэтому и
 * отказ доступа, и ошибка БД возвращаются как `ActionResult`, а исключение
 * read-layer'а превращается в текст для человека.
 */
export async function getSpecItemActivity(
  orgSlug: string,
  specItemId: string,
  /**
   * Читать записи строго после этой позиции (более старые). `null` — первая
   * страница. Курсор приходит из `nextCursor` предыдущего ответа: второй формат
   * пагинации не заводится.
   */
  before: ActivityCursor | null = null,
): Promise<ActionResult<ActivityFeedPage>> {
  const ctx = await requireOrgBySlug(orgSlug);
  const supabase = createAdminClient();

  // Позиция проверяется по организации: `org_id` берётся из строки БД, а не из
  // аргументов, поэтому чужой id не даст ни данных, ни утечки факта их наличия.
  // Удалённая позиция истории не отдаёт — карточка для неё закрыта.
  const { data: item } = await supabase
    .from("spec_items")
    .select("id, org_id")
    .eq("id", specItemId)
    .eq("org_id", ctx.orgId)
    .is("deleted_at", null)
    .maybeSingle();

  if (!item) return fail("Позиция не найдена");

  try {
    const page = await getSpecItemHistory(supabase, {
      orgId: item.org_id,
      specItemId: item.id,
      limit: ACTIVITY_PAGE_SIZE,
      ...(before ? { before } : {}),
    });

    return ok({ records: page.entries, nextCursor: page.nextCursor });
  } catch (error) {
    // Текст исключения — уже человекочитаемый (`Не удалось загрузить историю
    // (события): …`), но внутренние детали БД в интерфейс не уходят.
    console.error("[getSpecItemActivity]", error);
    return fail("Не удалось загрузить историю");
  }
}
