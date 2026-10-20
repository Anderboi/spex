import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  hasFavoriteMark,
  listFavoriteMaterialIds,
  MATERIAL_FAVORITES_INNER_SELECT,
  MATERIAL_FAVORITES_SELECT,
  saveMaterialFavorite,
} from "../lib/materials/favorites";

/**
 * Интеграционный тест избранного в библиотеке материалов: ЖИВАЯ БД linked-проекта.
 *
 * ── Почему отдельный файл и запуск вручную ─────────────────────────────────
 *
 * Тест пишет в реальную БД, поэтому он НЕ входит в `npm test`
 * (`vitest.config.mts` исключает `integration/**`) и запускается осознанно:
 *
 *   npx vitest run --config vitest.integration.config.mts
 *
 * Требуются применённые миграции
 * `supabase/migrations/20261020_001_add_material_favorites.sql` и
 * `…_002_add_material_favorites_rls.sql`: без таблицы тест честно упадёт на
 * первом же запросе.
 *
 * ── Что проверяется ────────────────────────────────────────────────────────
 *
 * Наблюдаемое поведение модуля избранного, а не устройство запросов:
 *
 *   * постановка и снятие отметки идемпотентны — повтор не ошибка и не дубль;
 *   * отметка личная: второй участник организации не видит и не снимает чужую;
 *   * `org_id` строки — граница видимости: отметка, записанная в чужой
 *     организации, в библиотеку целевой организации не попадает;
 *   * материал чужой организации отметить нельзя;
 *   * архивация (мягкое удаление) отметку сохраняет, восстановление возвращает
 *     материал вместе с отметкой;
 *   * окончательное удаление материала убирает отметку — битых записей нет;
 *   * `anon` не видит и не пишет таблицу (RLS без политики для анонима).
 *
 * ── Безопасность данных ────────────────────────────────────────────────────
 *
 * Тест заводит СВОИ материалы в тестовой организации, отмечает их своими
 * пользователями и убирает за собой: отметки удаляются, материалы стираются
 * физически. Чужие материалы, отметки и состав организации не меняются.
 */

/* ------------------------------------------------------------------ */
/*  Окружение                                                          */
/* ------------------------------------------------------------------ */

const ENV_PATH = resolve(process.cwd(), ".env.local");
if (existsSync(ENV_PATH)) {
  process.loadEnvFile(ENV_PATH);
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

/** Тестовая организация «MINIMAL» — та же, что у остальных интеграционных тестов. */
const TARGET_ORG = "a0a3fc2f-4bc6-4088-ab7c-68b70acb1e3c";

/** Соседняя организация — для проверки, что строка «не из моей организации» не видна. */
const OTHER_ORG = "4a12a734-1be7-4550-b3ef-e5b85100d712";

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const anon = createClient(SUPABASE_URL, ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/**
 * Двое участников тестовой организации.
 *
 * Роли не важны: отметка личная и не требует права менять материал, поэтому
 * берутся любые два члена — этого достаточно, чтобы проверить невидимость.
 */
const users = { a: "", b: "" };

/** Материалы прогона: общий для отметок и отдельный — для окончательного удаления. */
const materials = { shared: "", removable: "" };

/** Метка прогона: по ней убираются материалы, даже если тест упал посередине. */
const MARK = `favorites-test-${Date.now()}`;

beforeAll(async () => {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    throw new Error(
      "Интеграционный тест требует NEXT_PUBLIC_SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY в .env.local",
    );
  }

  const { data: members, error } = await admin
    .from("organization_members")
    .select("user_id")
    .eq("org_id", TARGET_ORG)
    .order("user_id")
    .limit(2);

  if (error) console.error("[integration] members", error.message);
  if (!members || members.length < 2) {
    throw new Error("В тестовой организации нужно минимум двое участников");
  }
  users.a = members[0].user_id;
  users.b = members[1].user_id;

  const { data: created, error: insertError } = await admin
    .from("materials")
    .insert([
      { org_id: TARGET_ORG, name: `${MARK} общий` },
      { org_id: TARGET_ORG, name: `${MARK} удаляемый` },
    ])
    .select("id, name");

  if (insertError) throw insertError;
  for (const row of created ?? []) {
    if (row.name.endsWith("удаляемый")) materials.removable = row.id;
    else materials.shared = row.id;
  }
  if (!materials.shared || !materials.removable) {
    throw new Error("Не удалось создать материалы прогона");
  }
});

afterAll(async () => {
  await cleanupRun();
});

/**
 * Уборка: отметки уходят вместе с материалами (каскад), остатки ищутся по метке
 * в названии — так прогон убирает и то, что осталось от упавшего кейса.
 */
async function cleanupRun() {
  const { data: leftovers } = await admin
    .from("materials")
    .select("id")
    .like("name", `${MARK}%`);

  for (const row of leftovers ?? []) {
    await admin.from("material_favorites").delete().eq("material_id", row.id);
    await admin.from("materials").delete().eq("id", row.id);
  }
}

/** Сколько строк отметки реально лежит в БД — проверка идемпотентности. */
async function countRows(materialId: string, userId: string) {
  const { count } = await admin
    .from("material_favorites")
    .select("user_id", { count: "exact", head: true })
    .eq("material_id", materialId)
    .eq("user_id", userId);
  return count ?? 0;
}

/**
 * Избранное пользователя, суженное до материалов прогона: боевые отметки этого
 * пользователя в тестовой организации не должны влиять на ожидания.
 */
function favoritesOf(userId: string) {
  return listFavoriteMaterialIds(admin, {
    orgId: TARGET_ORG,
    userId,
    materialIds: [materials.shared, materials.removable],
  });
}

beforeEach(async () => {
  // Каждый кейс начинает с чистых отметок: иначе «идемпотентность» проверяла бы
  // состояние, оставленное предыдущим кейсом.
  await admin
    .from("material_favorites")
    .delete()
    .in("material_id", [materials.shared, materials.removable]);

  // Материал мог остаться в архиве от упавшего кейса: прогон не должен
  // наследовать чужую незавершённую архивацию.
  await admin
    .from("materials")
    .update({ deleted_at: null })
    .in("id", [materials.shared, materials.removable]);
});

describe("отметка: постановка и снятие идемпотентны", () => {
  it("повторная постановка не создаёт второй строки", async () => {
    const first = await saveMaterialFavorite(admin, {
      orgId: TARGET_ORG,
      userId: users.a,
      materialId: materials.shared,
      favorite: true,
    });
    const second = await saveMaterialFavorite(admin, {
      orgId: TARGET_ORG,
      userId: users.a,
      materialId: materials.shared,
      favorite: true,
    });

    expect(first).toEqual({ ok: true, favorite: true });
    expect(second).toEqual({ ok: true, favorite: true });
    expect(await countRows(materials.shared, users.a)).toBe(1);
  });

  it("повторное снятие не падает и не оставляет строки", async () => {
    await saveMaterialFavorite(admin, {
      orgId: TARGET_ORG,
      userId: users.a,
      materialId: materials.shared,
      favorite: true,
    });

    const first = await saveMaterialFavorite(admin, {
      orgId: TARGET_ORG,
      userId: users.a,
      materialId: materials.shared,
      favorite: false,
    });
    const second = await saveMaterialFavorite(admin, {
      orgId: TARGET_ORG,
      userId: users.a,
      materialId: materials.shared,
      favorite: false,
    });

    expect(first).toEqual({ ok: true, favorite: false });
    expect(second).toEqual({ ok: true, favorite: false });
    expect(await countRows(materials.shared, users.a)).toBe(0);
  });

  it("список отдаёт ровно отмеченный материал", async () => {
    await saveMaterialFavorite(admin, {
      orgId: TARGET_ORG,
      userId: users.a,
      materialId: materials.shared,
      favorite: true,
    });

    const list = await favoritesOf(users.a);

    expect(list.ok).toBe(true);
    if (!list.ok) return;
    expect(list.materialIds).toEqual([materials.shared]);
  });
});

describe("выборка библиотеки: признак «отмечен мной»", () => {
  /**
   * Тот же вложенный фильтр, что в `getMaterialsPage`: отметки только этого
   * пользователя и этой организации. У материала без отметки вложение пустое, а
   * сама строка из выборки не выпадает. `favoriteOnly` — тот же запрос с
   * внутренним соединением, каким работает переключатель «Избранное»: материал
   * без моей отметки в выборку не попадает.
   */
  function libraryRows(userId: string, favoriteOnly = false) {
    const favorites = favoriteOnly
      ? MATERIAL_FAVORITES_INNER_SELECT
      : MATERIAL_FAVORITES_SELECT;

    return admin
      .from("materials")
      .select(`id, ${favorites}`, { count: "exact" })
      .eq("org_id", TARGET_ORG)
      .eq("material_favorites.user_id", userId)
      .eq("material_favorites.org_id", TARGET_ORG)
      .in("id", [materials.shared, materials.removable]);
  }

  it("чужая отметка не делает материал моим, а строки не задваиваются", async () => {
    for (const userId of [users.a, users.b]) {
      await saveMaterialFavorite(admin, {
        orgId: TARGET_ORG,
        userId,
        materialId: materials.shared,
        favorite: true,
      });
    }

    const { data, error, count } = await libraryRows(users.a);

    expect(error).toBeNull();
    // Две отметки на один материал не превращаются в две строки библиотеки: у
    // каждого материала в ответе ровно одна запись, счётчик — по материалам.
    expect(count).toBe(2);
    expect(data).toHaveLength(2);

    const shared = data?.find((row) => row.id === materials.shared);
    const removable = data?.find((row) => row.id === materials.removable);

    expect(hasFavoriteMark(shared?.material_favorites, users.a)).toBe(true);
    expect(hasFavoriteMark(shared?.material_favorites, users.b)).toBe(false);
    // Материал без отметки из выборки не выпадает.
    expect(removable).toBeTruthy();
    expect(hasFavoriteMark(removable?.material_favorites, users.a)).toBe(false);
  });

  it("фильтр «только избранное» оставляет мои отметки и не задваивает строки", async () => {
    await saveMaterialFavorite(admin, {
      orgId: TARGET_ORG,
      userId: users.a,
      materialId: materials.shared,
      favorite: true,
    });
    // Чужие отметки не должны расширять мой отфильтрованный список: коллега
    // отметил общий материал и материал без моей отметки.
    await saveMaterialFavorite(admin, {
      orgId: TARGET_ORG,
      userId: users.b,
      materialId: materials.shared,
      favorite: true,
    });
    await saveMaterialFavorite(admin, {
      orgId: TARGET_ORG,
      userId: users.b,
      materialId: materials.removable,
      favorite: true,
    });

    const { data, error, count } = await libraryRows(users.a, true);

    expect(error).toBeNull();
    expect(count).toBe(1);
    expect(data?.map((row) => row.id)).toEqual([materials.shared]);
  });

  it("отметка с чужой организацией карточку не подсвечивает", async () => {
    const { error } = await admin.from("material_favorites").insert({
      user_id: users.a,
      material_id: materials.shared,
      org_id: OTHER_ORG,
    });
    expect(error).toBeNull();

    const { data } = await libraryRows(users.a);
    const shared = data?.find((row) => row.id === materials.shared);

    expect(shared).toBeTruthy();
    expect(hasFavoriteMark(shared?.material_favorites, users.a)).toBe(false);
  });
});

describe("отметка личная: коллега её не видит и не меняет", () => {
  it("второй участник видит материал неотмеченным", async () => {
    await saveMaterialFavorite(admin, {
      orgId: TARGET_ORG,
      userId: users.a,
      materialId: materials.shared,
      favorite: true,
    });

    const mine = await favoritesOf(users.a);
    const colleague = await favoritesOf(users.b);

    expect(mine.ok && mine.materialIds).toEqual([materials.shared]);
    expect(colleague.ok && colleague.materialIds).toEqual([]);
  });

  it("коллега снимает свою отметку — чужая остаётся", async () => {
    await saveMaterialFavorite(admin, {
      orgId: TARGET_ORG,
      userId: users.a,
      materialId: materials.shared,
      favorite: true,
    });
    await saveMaterialFavorite(admin, {
      orgId: TARGET_ORG,
      userId: users.b,
      materialId: materials.shared,
      favorite: true,
    });

    const removed = await saveMaterialFavorite(admin, {
      orgId: TARGET_ORG,
      userId: users.b,
      materialId: materials.shared,
      favorite: false,
    });

    expect(removed).toEqual({ ok: true, favorite: false });
    expect(await countRows(materials.shared, users.a)).toBe(1);
    expect(await countRows(materials.shared, users.b)).toBe(0);
  });

  it("строка, записанная в чужой организации, в мою библиотеку не попадает", async () => {
    // Имитация испорченной/чужой строки: организация строки — не та, в которой
    // модуль читает избранное. Материал при этом остаётся материалом целевой
    // организации, поэтому каскад и внешние ключи не мешают.
    const { error } = await admin.from("material_favorites").insert({
      user_id: users.a,
      material_id: materials.shared,
      org_id: OTHER_ORG,
    });
    expect(error).toBeNull();

    const list = await favoritesOf(users.a);

    expect(list.ok && list.materialIds).toEqual([]);
  });

  it("материал чужой организации отметить нельзя", async () => {
    const result = await saveMaterialFavorite(admin, {
      orgId: OTHER_ORG,
      userId: users.a,
      materialId: materials.shared,
      favorite: true,
    });

    expect(result.ok).toBe(false);
    expect(await countRows(materials.shared, users.a)).toBe(0);
  });
});

describe("архив и окончательное удаление", () => {
  it("архивация отметку сохраняет, восстановление возвращает её вместе с материалом", async () => {
    await saveMaterialFavorite(admin, {
      orgId: TARGET_ORG,
      userId: users.a,
      materialId: materials.shared,
      favorite: true,
    });

    const archivedAt = new Date().toISOString();
    await admin
      .from("materials")
      .update({ deleted_at: archivedAt })
      .eq("id", materials.shared);

    const inArchive = await favoritesOf(users.a);
    expect(inArchive.ok && inArchive.materialIds).toEqual([materials.shared]);

    await admin
      .from("materials")
      .update({ deleted_at: null })
      .eq("id", materials.shared);

    const restored = await favoritesOf(users.a);
    expect(restored.ok && restored.materialIds).toEqual([materials.shared]);
  });

  it("окончательное удаление материала убирает отметку", async () => {
    await saveMaterialFavorite(admin, {
      orgId: TARGET_ORG,
      userId: users.a,
      materialId: materials.removable,
      favorite: true,
    });
    expect(await countRows(materials.removable, users.a)).toBe(1);

    const { error } = await admin
      .from("materials")
      .delete()
      .eq("id", materials.removable);
    expect(error).toBeNull();

    expect(await countRows(materials.removable, users.a)).toBe(0);
  });
});

describe("security: RLS Data API", () => {
  it("anon не читает отметки", async () => {
    await saveMaterialFavorite(admin, {
      orgId: TARGET_ORG,
      userId: users.a,
      materialId: materials.shared,
      favorite: true,
    });

    const { data } = await anon
      .from("material_favorites")
      .select("user_id, material_id")
      .limit(5);

    expect(data ?? []).toEqual([]);
  });

  it("anon не может поставить отметку", async () => {
    const { error } = await anon.from("material_favorites").insert({
      user_id: users.a,
      material_id: materials.shared,
      org_id: TARGET_ORG,
    });

    expect(error).not.toBeNull();
  });
});
