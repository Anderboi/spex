/**
 * Избранное в библиотеке материалов: личная отметка на материале.
 *
 * ── Почему отдельный модуль ────────────────────────────────────────────────
 *
 * Сессия, `orgSlug` → `orgId` и форма ответа для клиента живут в server action
 * (`actions/materials.ts`), а проверка принадлежности материала организации,
 * чтение и запись строк — здесь, куда клиент БД приходит аргументом (DI, как в
 * `lib/spec/payment-plan-mutations.ts`). Так контракт проверяется интеграционным
 * прогоном на живой БД, без Next и без сессии.
 *
 * ── Границы доверия ────────────────────────────────────────────────────────
 *
 * От клиента приходят только `materialId` и целевое состояние. `orgId` и
 * `userId` всегда из сессии: модуль не умеет отметить материал «за коллегу», а
 * отметка вне организации пользователя отсекается сверкой материала с `orgId`.
 * Права менять материал не нужны — отметка личная (её ставит и наблюдатель).
 *
 * ── Почему не upsert-«переключение» ────────────────────────────────────────
 *
 * Действие получает явное целевое состояние, а не «переключи». Повторный вызов
 * идемпотентен: постановка уже поставленного не ошибка (`on conflict do
 * nothing` по первичному ключу «пользователь — материал»), снятие снятого —
 * просто ноль строк. Гонка двух вкладок не рождает дублей (это свойство БД, а не
 * проверки в коде) и не переворачивает намерение пользователя.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../types";

/** Клиент БД: как у остальных слоёв, приходит аргументом. */
export type FavoritesDb = SupabaseClient<Database>;

/**
 * Отметки «избранное» вложением в строку библиотеки.
 *
 * Строка приходит с отметками только текущего пользователя: фильтр ставится по
 * вложенной таблице (`.eq("material_favorites.user_id", …)` в `getMaterialsPage`),
 * поэтому чужие строки в ответ не попадают. Без `inner` материалы без отметки из
 * выборки не выпадают; с ним — остаются только отмеченные, и `count` считает уже
 * отфильтрованный набор. Признак считается в `toMaterialListItem` (`isFavorite`).
 */
export const MATERIAL_FAVORITES_SELECT = "material_favorites ( user_id )";
/** Внутреннее соединение: материал без моей отметки в выборку не попадает. */
export const MATERIAL_FAVORITES_INNER_SELECT =
  "material_favorites!inner ( user_id )";

/**
 * Причина отказа: та же пара «код + текст», что у графика платежей
 * (`lib/spec/payment-plan-types.ts`). Код нужен server action и UI, текст —
 * человеку.
 */
export type FavoriteError = {
  code: "NOT_FOUND" | "FAILED";
  message: string;
};

export type SaveMaterialFavoriteArgs = {
  /** Организация из сессии — не из аргументов клиента. */
  orgId: string;
  /** Пользователь из сессии: чужие отметки модулю недоступны по смыслу. */
  userId: string;
  materialId: string;
  /** Целевое состояние: `true` — поставить, `false` — снять. */
  favorite: boolean;
};

export type SaveMaterialFavoriteResult =
  | { ok: true; favorite: boolean }
  | { ok: false; error: FavoriteError };

export type ListFavoriteMaterialIdsArgs = {
  orgId: string;
  userId: string;
  /** Сузить до конкретных материалов; пустой список — заведомо пустой ответ. */
  materialIds?: readonly string[];
};

export type ListFavoriteMaterialIdsResult =
  | { ok: true; materialIds: string[] }
  | { ok: false; error: FavoriteError };

/**
 * Поставить или снять личную отметку.
 *
 * Материал сначала сверяется с организацией: отметить материал, которого в этой
 * библиотеке нет, нельзя — иначе строка из чужой организации стала бы видимой
 * через «избранное». Архивный материал отметить можно: сердца в архиве нет, но
 * отметка, поставленная до архивации, живёт и возвращается вместе с материалом.
 */
export async function saveMaterialFavorite(
  db: FavoritesDb,
  args: SaveMaterialFavoriteArgs,
): Promise<SaveMaterialFavoriteResult> {
  const { orgId, userId, materialId, favorite } = args;

  const { data: material, error: materialError } = await db
    .from("materials")
    .select("id")
    .eq("id", materialId)
    .eq("org_id", orgId)
    .maybeSingle();

  if (materialError) {
    console.error("[saveMaterialFavorite:material]", materialError.message);
    return {
      ok: false,
      error: {
        code: "FAILED",
        message: "Не удалось проверить материал",
      },
    };
  }

  if (!material) {
    return {
      ok: false,
      error: {
        code: "NOT_FOUND",
        message: "Материал не найден в библиотеке",
      },
    };
  }

  if (favorite) {
    // `ignoreDuplicates` — это `on conflict do nothing` по первичному ключу
    // (user_id, material_id): повторная отметка не ошибка и не дубль.
    const { error } = await db.from("material_favorites").upsert(
      { user_id: userId, material_id: materialId, org_id: orgId },
      { onConflict: "user_id,material_id", ignoreDuplicates: true },
    );

    if (error) {
      console.error("[saveMaterialFavorite:insert]", error.message);
      return {
        ok: false,
        error: {
          code: "FAILED",
          message: "Не удалось добавить материал в избранное",
        },
      };
    }

    return { ok: true, favorite: true };
  }

  // Снятие фильтруется и по организации: строка, записанная в чужой организации
  // (испорченные данные), не должна сниматься из-под этой библиотеки.
  const { error } = await db
    .from("material_favorites")
    .delete()
    .eq("user_id", userId)
    .eq("material_id", materialId)
    .eq("org_id", orgId);

  if (error) {
    console.error("[saveMaterialFavorite:delete]", error.message);
    return {
      ok: false,
      error: {
        code: "FAILED",
        message: "Не удалось убрать материал из избранного",
      },
    };
  }

  return { ok: true, favorite: false };
}

/**
 * Материалы, отмеченные этим пользователем в этой организации.
 *
 * Чтение всегда фильтруется по пользователю и организации явно: приложение
 * ходит сервисной ролью, для которой RLS не преграда (политика в БД — второй
 * слой). Возвращаются только свои строки — чужие отметки не видны. Этой
 * функцией проверяется видимость отметок в интеграционном прогоне; список
 * библиотеки берёт признак «отмечен мной» вложением в свою выборку
 * (`getMaterialsPage`), чтобы не делать второй проход по карточкам.
 */
export async function listFavoriteMaterialIds(
  db: FavoritesDb,
  args: ListFavoriteMaterialIdsArgs,
): Promise<ListFavoriteMaterialIdsResult> {
  const { orgId, userId, materialIds } = args;

  // Пустой `in ()` — синтаксическая ошибка PostgREST, а ответ всё равно пустой.
  if (materialIds && materialIds.length === 0) {
    return { ok: true, materialIds: [] };
  }

  let query = db
    .from("material_favorites")
    .select("material_id")
    .eq("org_id", orgId)
    .eq("user_id", userId);

  if (materialIds) query = query.in("material_id", [...materialIds]);

  const { data, error } = await query;

  if (error) {
    console.error("[listFavoriteMaterialIds]", error.message);
    return {
      ok: false,
      error: {
        code: "FAILED",
        message: "Не удалось загрузить избранное",
      },
    };
  }

  return { ok: true, materialIds: (data ?? []).map((row) => row.material_id) };
}

/**
 * Есть ли моя отметка во вложенной выборке строки библиотеки.
 *
 * `value` — это `material_favorites (user_id)` из строки материала (массив или
 * объект в зависимости от кардинальности ответа PostgREST), а не сама строка
 * материала. Сверка по `userId` держит ответ верным, даже если фильтр вложения
 * не применился и в выборку попали чужие отметки.
 */
export function hasFavoriteMark(value: unknown, userId: string): boolean {
  const rows = Array.isArray(value) ? value : value ? [value] : [];

  return rows.some((row) => {
    const record = row as { user_id?: unknown } | null;
    return record?.user_id === userId;
  });
}
