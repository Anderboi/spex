import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  addPaymentPlan,
  listPaymentPlans,
  movePaymentPlanPosition,
  removePaymentPlan,
  updatePaymentPlan,
} from "../lib/spec/payment-plan-mutations";
import { recordSpecItemEvents } from "../lib/spec/history";

/**
 * Интеграционный тест графика платежей: ЖИВАЯ БД linked-проекта.
 *
 * ── Почему отдельный файл и запуск вручную ─────────────────────────────────
 *
 * Этот тест пишет в реальную БД, поэтому он НЕ входит в `npm test`
 * (`vitest.config.mts` исключает `integration/**`) и запускается только осознанно:
 *
 *   npx vitest run --config vitest.integration.config.mts
 *
 * Требуется применённая миграция
 * `supabase/migrations/20261009_001_add_spec_item_payment_plans.sql`
 * (`npx supabase db push`): без таблицы тест честно упадёт на первом же запросе.
 *
 * ── Что проверяется ────────────────────────────────────────────────────────
 *
 * Ровно то, чего не могут проверить unit-тесты на подставном клиенте:
 *
 *   * `RESTRICT` не даёт физически удалить позицию/проект/организацию, по которым
 *     есть строки графика (ADR 0004) — вместо каскадной потери финансовой истории;
 *   * частичный уникальный индекс действительно запрещает два одинаковых номера
 *     порядка среди неудалённых строк;
 *   * триггер `payment_plan_sync_scope()` перезаписывает `org_id`/`project_id` из
 *     позиции, поэтому подсунуть чужую организацию вставкой невозможно;
 *   * перестановка не оставляет ни дублей, ни дыр в порядке;
 *   * RLS закрывает таблицу от `anon` и допускает чтение только участнику
 *     организации;
 *   * каждое действие попадает в `spec_item_events` своим видом.
 *
 * ── Безопасность данных ────────────────────────────────────────────────────
 *
 * Цель — существующая позиция тестовой организации (та же, что у теста файлов).
 * Тест создаёт только строки графика и убирает их за собой: сначала мягко (это и
 * есть проверка мягкого удаления), затем физически в `afterAll`, чтобы прогоны не
 * копили мусор. Ничего, кроме этих строк и событий журнала, не меняется.
 *
 * Порядок шагов внутри файла — последовательный: конфиг закрепляет один воркер.
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

/**
 * Цель прогона: тестовая организация «MINIMAL», проект и позиция выбраны явно,
 * чтобы прогон был воспроизводимым, а не зависел от порядка строк в БД.
 */
const TARGET = {
  orgId: "a0a3fc2f-4bc6-4088-ab7c-68b70acb1e3c",
  projectId: "103ba9fe-43e1-4f00-919d-2cf9d7d37281",
  specItemId: "15753bce-598e-4fc8-ae8e-f6df837fc047",
};

/** Соседняя позиция того же проекта — для проверки чужого плана. */
const NEIGHBOUR_ITEM = "a48a8c82-5556-4f66-8c92-a108c8c4e68a";

/** Чужая организация — для проверки cross-org. */
const OTHER_ORG = "62a172b9-314a-4975-8420-f550f2a4417c";

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const anon = createClient(SUPABASE_URL, ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const baseArgs = { orgId: TARGET.orgId, specItemId: TARGET.specItemId };

/** Автор строк: реальный пользователь организации, иначе FK не пройдёт. */
const actor = { id: "", name: "Проверка графика (тест)", email: null };

/**
 * Идентификаторы строк, созданных прогоном.
 *
 * Уборка идёт по метке в названии (`cleanupRun`), а список нужен только там, где
 * тесту важно знать, что именно он создал.
 */
const createdPlanIds: string[] = [];

beforeAll(async () => {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    throw new Error(
      "Интеграционный тест требует NEXT_PUBLIC_SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY в .env.local",
    );
  }

  // Автор: любой пользователь, состоящий в целевой организации. Первый
  // подходящий — этого достаточно: тест проверяет график, а не права.
  const { data: member, error } = await admin
    .from("organization_members")
    .select("user_id")
    .eq("org_id", TARGET.orgId)
    .limit(1)
    .maybeSingle();

  if (error) console.error("[integration] member", error.message);
  actor.id = member?.user_id ?? "";
});

afterAll(async () => {
  await cleanupRun();
});

/**
 * Уборка строк и событий, созданных прогоном.
 *
 * Вызывается и в `beforeAll`, и в `afterAll`, и перед каждым тестом: тесты
 * этого файла пишут в ОДНУ позицию живой БД, а нумерация порядка внутри позиции
 * уникальна — строки, оставшиеся от предыдущего кейса, смещали бы номера и
 * делали бы `moved` бессмысленным. Поэтому каждый кейс начинает с чистого
 * графика, но не пустой БД: чужие строки (в том числе созданные вручную через
 * интерфейс) не трогаются.
 *
 * Метка прогона — суффикс «(тест)» в названии: по нему строки и находятся.
 * События убираются по `spec_item_id` и перечисленным видам — их тест пишет сам.
 */
async function cleanupRun() {
  const { error: planError } = await admin
    .from("spec_item_payment_plans")
    .delete()
    .eq("spec_item_id", TARGET.specItemId)
    .like("title", "%(тест)%");

  if (planError) console.error("[integration] cleanup plans", planError.message);

  const { error: eventError } = await admin
    .from("spec_item_events")
    .delete()
    .eq("spec_item_id", TARGET.specItemId)
    .in("kind", [
      "payment_plan_added",
      "payment_plan_changed",
      "payment_plan_removed",
    ]);

  if (eventError) console.error("[integration] cleanup events", eventError.message);

  createdPlanIds.length = 0;
}

beforeEach(async () => {
  await cleanupRun();
});

/** Прочитать строку графика напрямую: тест проверяет то, что лежит в БД. */
async function planRow(id: string) {
  const { data, error } = await admin
    .from("spec_item_payment_plans")
    .select(
      "id, org_id, project_id, spec_item_id, title, amount, condition, due_date, position, deleted_at",
    )
    .eq("id", id)
    .maybeSingle();

  expect(error).toBeNull();
  return data;
}

/** Все активные строки позиции в порядке отображения. */
async function activePlans() {
  const { data, error } = await admin
    .from("spec_item_payment_plans")
    .select("id, position, amount, deleted_at")
    .eq("spec_item_id", TARGET.specItemId)
    .is("deleted_at", null)
    .order("position", { ascending: true });

  expect(error).toBeNull();
  return data ?? [];
}

/** Добавить строку и запомнить её id для уборки. */
async function addPlan(over: Partial<{ title: string; amount: number }> = {}) {
  const result = await addPaymentPlan(admin, {
    ...baseArgs,
    actor,
    data: {
      title: over.title ?? "ПРОВЕРКА ГРАФИКА (тест)",
      amount: over.amount ?? 1000,
      condition: null,
      dueDate: null,
    },
  });

  if (!result.ok) throw new Error(JSON.stringify(result.error));
  createdPlanIds.push(result.plan.id);
  return result.plan;
}

/* ------------------------------------------------------------------ */
/*  1-2. Таблица и ограничения схемы                                   */
/* ------------------------------------------------------------------ */

describe("схема: таблица и ограничения", () => {
  it("таблица графика существует и читается", async () => {
    const { error } = await admin
      .from("spec_item_payment_plans")
      .select("id", { count: "exact", head: true });

    expect(error).toBeNull();
  });

  it("CHECK не пропускает нулевую, отрицательную сумму и пустое название", async () => {
    for (const bad of [
      { title: "ПРОВЕРКА (тест)", amount: 0 },
      { title: "ПРОВЕРКА (тест)", amount: -1 },
      { title: "   ", amount: 100 },
    ]) {
      const { error } = await admin.from("spec_item_payment_plans").insert({
        org_id: TARGET.orgId,
        project_id: TARGET.projectId,
        spec_item_id: TARGET.specItemId,
        title: bad.title,
        amount: bad.amount,
        condition: null,
        due_date: null,
        position: 9999,
        created_by: null,
      });

      expect(error, JSON.stringify(bad)).not.toBeNull();
    }
  });

  it("триггер подставляет org_id и project_id из позиции", async () => {
    // Вставка в обход кода: чужую организацию подсунуть нельзя — триггер
    // перезапишет её из позиции, и расхождение «строка в одной организации,
    // позиция в другой» невозможно.
    const { data, error } = await admin
      .from("spec_item_payment_plans")
      .insert({
        org_id: OTHER_ORG,
        project_id: "00000000-0000-4000-8000-000000000000",
        spec_item_id: TARGET.specItemId,
        title: "ПРОВЕРКА ТРИГГЕРА (тест)",
        amount: 1,
        condition: null,
        due_date: null,
        position: 9998,
        created_by: null,
      })
      .select("id, org_id, project_id")
      .single();

    expect(error).toBeNull();
    const row = data as { id: string; org_id: string; project_id: string };
    createdPlanIds.push(row.id);

    expect(row.org_id).toBe(TARGET.orgId);
    expect(row.project_id).toBe(TARGET.projectId);
  });

  it("частичный уникальный индекс запрещает два одинаковых порядка", async () => {
    const first = await addPlan({ title: "ПОРЯДОК 1 (тест)" });
    const second = await addPlan({ title: "ПОРЯДОК 2 (тест)" });

    // Прямой UPDATE в обход кода: номер порядка занят — БД обязана отказать.
    const { error } = await admin
      .from("spec_item_payment_plans")
      .update({ position: first.position })
      .eq("id", second.id);

    expect(error).not.toBeNull();
    expect(error!.code).toBe("23505");
  });

  it("RESTRICT не даёт физически удалить позицию со строками графика", async () => {
    await addPlan({ title: "ПРОВЕРКА RESTRICT (тест)" });

    // Позиция удаляется физически: с `cascade` строки графика исчезли бы молча,
    // а финансовая история каскадом не удаляется (ADR 0004).
    const { error } = await admin
      .from("spec_items")
      .delete()
      .eq("id", TARGET.specItemId);

    expect(error).not.toBeNull();
    expect(error!.code).toBe("23503");

    // Ничего не пропало: цель теста жива.
    const { data } = await admin
      .from("spec_items")
      .select("id")
      .eq("id", TARGET.specItemId)
      .maybeSingle();
    expect(data?.id).toBe(TARGET.specItemId);
  });

  it("физическое удаление строки графика возможно (это не история оплат)", async () => {
    // `RESTRICT` защищает от удаления РОДИТЕЛЯ, а не самой строки: строка
    // графика — не финансовая история, её штатное удаление мягкое, но уборка
    // строки, созданной в обход кода, должна быть возможна.
    const plan = await addPlan({ title: "ПРОВЕРКА УДАЛЕНИЯ (тест)" });

    const { error } = await admin
      .from("spec_item_payment_plans")
      .delete()
      .eq("id", plan.id);

    expect(error).toBeNull();
    createdPlanIds.splice(createdPlanIds.indexOf(plan.id), 1);
  });
});

/* ------------------------------------------------------------------ */
/*  3-4. Ядро на живой БД: список, правка, порядок, удаление            */
/* ------------------------------------------------------------------ */

describe("ядро: список, правка, порядок", () => {
  it("list отдаёт строки позиции в порядке номеров", async () => {
    const result = await listPaymentPlans(admin, baseArgs);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const positions = result.plans.map((plan) => plan.position);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    // Сумма приходит числом, а не строкой `numeric`.
    for (const plan of result.plans) {
      expect(typeof plan.amount).toBe("number");
    }
  });

  it("add ставит строку в конец, а событие принимает живой CHECK", async () => {
    const before = await activePlans();
    const result = await addPaymentPlan(admin, {
      ...baseArgs,
      actor,
      data: {
        title: "СОБЫТИЕ (тест)",
        amount: 2500,
        condition: null,
        dueDate: null,
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const plan = result.plan;
    createdPlanIds.push(plan.id);

    const after = await activePlans();
    expect(after).toHaveLength(before.length + 1);
    expect(after.at(-1)!.id).toBe(plan.id);

    // Ядро события НЕ пишет — их пишет server action (там это единая точка для
    // всех операций). Тест делает тот же шаг тем же способом: запись события
    // проверяется против ЖИВОГО CHECK, который и есть предмет этого файла.
    expect(result.events).toHaveLength(1);
    expect(result.events[0].kind).toBe("payment_plan_added");
    await recordSpecItemEvents(admin, result.events);

    const { data, error } = await admin
      .from("spec_item_events")
      .select("id, payload")
      .eq("spec_item_id", TARGET.specItemId)
      .eq("kind", "payment_plan_added")
      .order("created_at", { ascending: false })
      .limit(1);

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(
      (data as { payload: Record<string, unknown> }[])[0].payload,
    ).toMatchObject({ title: "СОБЫТИЕ (тест)", amount: 2500, plan_id: plan.id });
  });

  it("update меняет поля и пишет таблицу изменений", async () => {
    const plan = await addPlan({ title: "ПРАВКА (тест)", amount: 1000 });

    const result = await updatePaymentPlan(admin, {
      ...baseArgs,
      actor,
      planId: plan.id,
      data: {
        title: "ПРАВКА (тест)",
        amount: 1750,
        condition: "До поставки",
        dueDate: "2026-12-01",
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.amount).toBe(1750);
    expect(result.plan.condition).toBe("До поставки");

    const row = await planRow(plan.id);
    // `numeric` через PostgREST приходит числом: строка "1750.00" — это `psql`,
    // а не Data API, и ждать её здесь значило бы проверять формат ответа, а не
    // записанное значение.
    expect(row!.amount).toBe(1750);
    expect(row!.due_date).toBe("2026-12-01");

    await recordSpecItemEvents(admin, result.events);
    const { data } = await admin
      .from("spec_item_events")
      .select("id, payload")
      .eq("spec_item_id", TARGET.specItemId)
      .eq("kind", "payment_plan_changed")
      .order("created_at", { ascending: false })
      .limit(1);

    expect(
      (data as { payload: { changes: unknown } }[])[0].payload.changes,
    ).toEqual(
      expect.arrayContaining([
        { field: "amount", from: 1000, to: 1750 },
        { field: "due_date", from: null, to: "2026-12-01" },
      ]),
    );
  });

  it("перестановка обменивает номера и не оставляет дублей", async () => {
    const first = await addPlan({ title: "ПОРЯДОК A (тест)" });
    const second = await addPlan({ title: "ПОРЯДОК B (тест)" });
    const third = await addPlan({ title: "ПОРЯДОК C (тест)" });

    const result = await movePaymentPlanPosition(admin, {
      ...baseArgs,
      planId: third.id,
      direction: "up",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outcome.moved).toBe(true);
    // Обмен номерами произошёл ровно между C и его соседом B: обмен возвращает
    // номера обеих строк, и они должны совпасть с тем, что лежит в БД.
    expect(result.outcome.position).toEqual({
      from: second.position,
      to: third.position,
    });

    const rows = await activePlans();
    const positions = rows.map((row) => row.position);
    // Уникальный индекс не даёт двум строкам делить номер — это и есть гарантия
    // «перестановка не оставляет дублей». Проверяется и построчно, потому что
    // индекс индексирует лишь АКТИВНЫЕ строки.
    expect(new Set(positions).size).toBe(positions.length);

    const ordered = rows.map((row) => row.id);
    // C встал ПЕРЕД B, A не двигался.
    expect(ordered.indexOf(third.id)).toBe(ordered.indexOf(second.id) - 1);
    expect(ordered).toContain(first.id);
    expect(rows.find((row) => row.id === third.id)!.position).toBe(
      second.position,
    );
    expect(rows.find((row) => row.id === second.id)!.position).toBe(
      third.position,
    );
  });

  it("первую строку вверх не поднять: moved = false, состояние не изменилось", async () => {
    const plans = await activePlans();
    const first = plans[0];

    const result = await movePaymentPlanPosition(admin, {
      ...baseArgs,
      planId: first.id,
      direction: "up",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outcome.moved).toBe(false);
    expect(result.outcome.position).toBeNull();

    const after = await activePlans();
    expect(after.map((row) => row.id)).toEqual(plans.map((row) => row.id));
  });

  it("remove мягко скрывает строку и пишет событие", async () => {
    const plan = await addPlan({ title: "УДАЛЕНИЕ (тест)" });

    const result = await removePaymentPlan(admin, {
      ...baseArgs,
      actor,
      planId: plan.id,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.deleted).toBe(true);

    const row = await planRow(plan.id);
    expect(row!.deleted_at).not.toBeNull();
    // Из списка строка исчезает, из журнала — нет.
    const listed = await listPaymentPlans(admin, baseArgs);
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.plans.map((entry) => entry.id)).not.toContain(plan.id);

    // Снимок снят ДО мягкого удаления: после него строку в списках не прочитать,
    // и подпись для ленты брать было бы неоткуда.
    expect(result.events).toHaveLength(1);
    await recordSpecItemEvents(admin, result.events);

    const { data } = await admin
      .from("spec_item_events")
      .select("id, payload")
      .eq("spec_item_id", TARGET.specItemId)
      .eq("kind", "payment_plan_removed")
      .order("created_at", { ascending: false })
      .limit(1);

    expect((data as { payload: { title: string } }[])[0].payload.title).toBe(
      "УДАЛЕНИЕ (тест)",
    );
  });

  it("повторное удаление идемпотентно", async () => {
    const plan = await addPlan({ title: "ПОВТОР УДАЛЕНИЯ (тест)" });

    const first = await removePaymentPlan(admin, {
      ...baseArgs,
      actor,
      planId: plan.id,
    });
    const second = await removePaymentPlan(admin, {
      ...baseArgs,
      actor,
      planId: plan.id,
    });

    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.deleted).toBe(true);
    expect(second.deleted).toBe(false);
    expect(second.events).toEqual([]);
  });

  it("чужая организация не видит и не правит строки графика", async () => {
    const plan = await addPlan({ title: "ЧУЖАЯ ОРГ (тест)" });
    const foreignArgs = { orgId: OTHER_ORG, specItemId: TARGET.specItemId };

    const list = await listPaymentPlans(admin, foreignArgs);
    const update = await updatePaymentPlan(admin, {
      ...foreignArgs,
      actor,
      planId: plan.id,
      data: { title: "Подмена", amount: 1, condition: null, dueDate: null },
    });
    const remove = await removePaymentPlan(admin, {
      ...foreignArgs,
      actor,
      planId: plan.id,
    });

    for (const result of [list, update, remove]) {
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.error.code).toBe("NOT_FOUND");
    }

    // Строка не изменилась: чужой запрос не должен был её тронуть.
    const row = await planRow(plan.id);
    expect(row!.title).toBe("ЧУЖАЯ ОРГ (тест)");
    expect(row!.deleted_at).toBeNull();
  });

  it("план чужой позиции не правится через свою", async () => {
    const plan = await addPlan({ title: "ЧУЖАЯ ПОЗИЦИЯ (тест)" });

    const result = await updatePaymentPlan(admin, {
      orgId: TARGET.orgId,
      specItemId: NEIGHBOUR_ITEM,
      actor,
      planId: plan.id,
      data: { title: "Подмена", amount: 1, condition: null, dueDate: null },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("NOT_FOUND");
  });
});

/* ------------------------------------------------------------------ */
/*  5. RLS через Data API                                              */
/* ------------------------------------------------------------------ */

describe("security: RLS Data API", () => {
  it("anon не читает график (политика выдана только authenticated)", async () => {
    const { data } = await anon
      .from("spec_item_payment_plans")
      .select("id, amount")
      .limit(5);

    expect(data ?? []).toEqual([]);
  });

  it("anon не может вставить строку", async () => {
    const { error } = await anon.from("spec_item_payment_plans").insert({
      org_id: TARGET.orgId,
      project_id: TARGET.projectId,
      spec_item_id: TARGET.specItemId,
      title: "ANON (тест)",
      amount: 1,
      position: 9997,
    });

    expect(error).not.toBeNull();
  });
});
