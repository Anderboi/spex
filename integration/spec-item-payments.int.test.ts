import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  createPayment,
  hasActivePayments,
  listPayments,
  removePayment,
  updatePayment,
} from "../lib/spec/payment-mutations";
import {
  addPaymentPlan,
  listPaymentPlans,
  removePaymentPlan,
} from "../lib/spec/payment-plan-mutations";
import { summarisePaymentSchedule } from "../lib/spec/payment-schedule";
import { recordSpecItemEvents } from "../lib/spec/history";

/**
 * Интеграционный тест фактических оплат: ЖИВАЯ БД linked-проекта.
 *
 * ── Почему отдельный файл и запуск вручную ─────────────────────────────────
 *
 * Этот тест пишет в реальную БД, поэтому он НЕ входит в `npm test`
 * (`vitest.config.mts` исключает `integration/**`) и запускается только осознанно:
 *
 *   npx vitest run --config vitest.integration.config.mts
 *
 * Требуется применённая миграция
 * `supabase/migrations/20261010_001_add_spec_item_payments.sql`. Без неё тест
 * честно упадёт на первом же запросе: колонки вида записи `kind` в живой таблице
 * до этой миграции нет.
 *
 * ── Что проверяется ────────────────────────────────────────────────────────
 *
 * Ровно то, чего не могут проверить unit-тесты на подставном клиенте:
 *
 *   * составной внешний ключ не даёт привязать оплату к строке графика ЧУЖОЙ
 *     позиции, а `MATCH SIMPLE` разрешает оплату без плана;
 *   * `RESTRICT` не даёт физически удалить позицию и проект с оплатами;
 *   * уникальный индекс идемпотентности действительно один на организацию, а
 *     повтор запроса возвращает ту же запись;
 *   * строка графика с неудалённой оплатой не удаляется (решение Q9), отменённая
 *     — удаляется;
 *   * журнал принимает новые виды событий живым CHECK;
 *   * **цена и количество позиции не меняют ни одной сохранённой суммы** —
 *     главное правило этапа (REPORT §6.2);
 *   * RLS закрывает таблицу от `anon`.
 *
 * ── Безопасность данных ────────────────────────────────────────────────────
 *
 * Цель — существующая позиция тестовой организации (та же, что у тестов графика
 * и файлов). Тест создаёт строки графика, оплаты и события, а убирает их за
 * собой: сначала мягко (это и есть проверка мягкого удаления), затем физически в
 * `afterAll`, чтобы прогоны не копили мусор. Ничего, кроме своих строк и
 * событий, не меняется. Цена и количество позиции, которые трогает проверка
 * «стоимость не влияет на суммы», восстанавливаются в исходное значение.
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

/** Соседняя позиция того же проекта — для проверки чужого плана и чужого проекта. */
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

/** Автор записей: реальный пользователь организации, иначе FK не пройдёт. */
const actor = { id: "", name: "Проверка оплат (тест)", email: null };

/** Метка прогона: по ней находятся и убираются только свои строки. */
const MARK = "(тест-оплата)";

beforeAll(async () => {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    throw new Error(
      "Интеграционный тест требует NEXT_PUBLIC_SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY в .env.local",
    );
  }

  // Автор: любой пользователь, состоящий в целевой организации. Первый
  // подходящий — этого достаточно: тест проверяет оплаты, а не права.
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
 * Уборка строк и событий прогона.
 *
 * Оплаты убираются ПЕРВЫМИ: строка графика, по которой есть неудалённая оплата,
 * удалиться не даст (это и есть проверка запрета). Порядок «оплаты → график →
 * события» повторяет правило продукта, а не обходит его.
 *
 * Метка — суффикс в названии строки графика и в комментарии оплаты: чужие строки
 * (в том числе созданные вручную через интерфейс) не трогаются.
 */
async function cleanupRun() {
  const { error: paymentsError } = await admin
    .from("spec_item_payments")
    .delete()
    .eq("spec_item_id", TARGET.specItemId)
    .like("comment", `%${MARK}%`);

  if (paymentsError) {
    console.error("[integration] cleanup payments", paymentsError.message);
  }

  const { error: plansError } = await admin
    .from("spec_item_payment_plans")
    .delete()
    .eq("spec_item_id", TARGET.specItemId)
    .like("title", `%${MARK}%`);

  if (plansError) console.error("[integration] cleanup plans", plansError.message);

  const { error: eventsError } = await admin
    .from("spec_item_events")
    .delete()
    .eq("spec_item_id", TARGET.specItemId)
    .in("kind", [
      "payment_plan_added",
      "payment_plan_changed",
      "payment_plan_removed",
      "payment_added",
      "payment_changed",
      "payment_removed",
    ]);

  if (eventsError) console.error("[integration] cleanup events", eventsError.message);
}

beforeEach(async () => {
  await cleanupRun();
});

/* ------------------------------------------------------------------ */
/*  Вспомогательные операции                                           */
/* ------------------------------------------------------------------ */

/** Идентификаторы строк графика прогона: нужны там, где тест их сравнивает. */
const planIds: string[] = [];

/** Добавить строку графика с меткой прогона. */
async function addPlan(over: { title?: string; amount?: number } = {}) {
  const result = await addPaymentPlan(admin, {
    ...baseArgs,
    actor,
    data: {
      title: over.title ?? `ГРАФИК ${MARK}`,
      amount: over.amount ?? 10000,
      condition: null,
      dueDate: null,
    },
  });

  if (!result.ok) throw new Error(JSON.stringify(result.error));
  planIds.push(result.plan.id);
  return result.plan;
}

/** Внести оплату по правилам ядра. Комментарий всегда несёт метку прогона. */
async function addPayment(over: {
  amount?: number;
  planId?: string | null;
  kind?: "payment" | "refund";
  key?: string;
  comment?: string;
  specItemId?: string;
}) {
  const key = over.key ?? crypto.randomUUID();
  const result = await createPayment(admin, {
    orgId: TARGET.orgId,
    specItemId: over.specItemId ?? TARGET.specItemId,
    actor,
    idempotencyKey: key,
    data: {
      kind: over.kind ?? "payment",
      amount: over.amount ?? 1000,
      paidAt: null,
      paymentPlanId: over.planId === undefined ? null : over.planId,
      comment: over.comment ?? `ПРОВЕРКА ${MARK}`,
    },
  });

  return { result, key };
}

/** Строка оплаты напрямую: тест проверяет то, что лежит в БД. */
async function paymentRow(id: string) {
  const { data, error } = await admin
    .from("spec_item_payments")
    .select(
      "id, org_id, project_id, spec_item_id, kind, amount, paid_at, payment_plan_id, comment, created_by, author_name_snapshot, code_snapshot, name_snapshot, project_title_snapshot, idempotency_key, deleted_at",
    )
    .eq("id", id)
    .maybeSingle();

  expect(error).toBeNull();
  return data;
}

/* ------------------------------------------------------------------ */
/*  1. Схема: виды записи, составной ключ, запреты                     */
/* ------------------------------------------------------------------ */

describe("схема: виды записи и ограничения", () => {
  it("таблица оплат существует и читается", async () => {
    const { error } = await admin
      .from("spec_item_payments")
      .select("id", { count: "exact", head: true });

    expect(error).toBeNull();
  });

  it("вид записи ограничен двумя значениями, сумма остаётся положительной", async () => {
    const plan = await addPlan();

    // Вид вне словаря отвергается CHECK'ом.
    const { error: kindError } = await admin.from("spec_item_payments").insert({
      org_id: TARGET.orgId,
      project_id: TARGET.projectId,
      spec_item_id: TARGET.specItemId,
      payment_plan_id: plan.id,
      kind: "transfer",
      amount: 1,
      comment: `НЕВЕРНЫЙ ВИД ${MARK}`,
    });

    expect(kindError).not.toBeNull();
    expect(kindError!.code).toBe("23514");

    // Ноль и минус — тоже: знак не выражает возврат (решение O1).
    for (const amount of [0, -1]) {
      const { error } = await admin.from("spec_item_payments").insert({
        org_id: TARGET.orgId,
        project_id: TARGET.projectId,
        spec_item_id: TARGET.specItemId,
        payment_plan_id: plan.id,
        kind: "refund",
        amount,
        comment: `НУЛЕВАЯ СУММА ${MARK}`,
      });

      expect(error, `amount=${amount}`).not.toBeNull();
      expect(error!.code).toBe("23514");
    }
  });

  it("триггер подставляет организацию, проект и снимки из позиции", async () => {
    // Вставка в обход кода: чужую организацию подсунуть нельзя — триггер
    // перезапишет её из позиции, а снимки возьмёт из позиции и проекта.
    const { data, error } = await admin
      .from("spec_item_payments")
      .insert({
        org_id: OTHER_ORG,
        project_id: "00000000-0000-4000-8000-000000000000",
        spec_item_id: TARGET.specItemId,
        kind: "payment",
        amount: 1,
        comment: `ПРОВЕРКА ТРИГГЕРА ${MARK}`,
      })
      .select(
        "id, org_id, project_id, code_snapshot, name_snapshot, project_title_snapshot",
      )
      .single();

    expect(error).toBeNull();
    const row = data as {
      id: string;
      org_id: string;
      project_id: string;
      code_snapshot: string | null;
      name_snapshot: string | null;
      project_title_snapshot: string | null;
    };

    expect(row.org_id).toBe(TARGET.orgId);
    expect(row.project_id).toBe(TARGET.projectId);
    // Снимки заполнены: подпись для ленты берётся из строки, а не из клиента.
    expect(row.name_snapshot).not.toBeNull();
    expect(row.project_title_snapshot).not.toBeNull();

    await admin.from("spec_item_payments").delete().eq("id", row.id);
  });

  it("оплату нельзя привязать к строке графика чужой позиции", async () => {
    // Строка графика СОСЕДНЕЙ позиции того же проекта.
    const neighbour = await addPaymentPlan(admin, {
      orgId: TARGET.orgId,
      specItemId: NEIGHBOUR_ITEM,
      actor,
      data: {
        title: `ЧУЖАЯ СТРОКА ${MARK}`,
        amount: 5000,
        condition: null,
        dueDate: null,
      },
    });
    expect(neighbour.ok).toBe(true);
    if (!neighbour.ok) return;

    const { error } = await admin.from("spec_item_payments").insert({
      org_id: TARGET.orgId,
      project_id: TARGET.projectId,
      spec_item_id: TARGET.specItemId,
      payment_plan_id: neighbour.plan.id,
      kind: "payment",
      amount: 100,
      comment: `ЧУЖОЙ ПЛАН ${MARK}`,
    });

    // 23503 — нарушение внешнего ключа: составной ключ требует пару
    // (план, позиция), а её для чужой позиции не существует.
    expect(error).not.toBeNull();
    expect(error!.code).toBe("23503");

    // Уборка: строка графика соседней позиции удаляется физически.
    await admin
      .from("spec_item_payment_plans")
      .delete()
      .eq("id", neighbour.plan.id);
  });

  it("оплата без плана разрешена (MATCH SIMPLE)", async () => {
    const { result } = await addPayment({ planId: null, amount: 700 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payment.paymentPlanId).toBeNull();

    const row = await paymentRow(result.payment.id);
    expect(row!.payment_plan_id).toBeNull();
  });

  it("RESTRICT не даёт удалить позицию с оплатами", async () => {
    await addPayment({ amount: 100 });

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

  it("RESTRICT не даёт удалить проект с оплатами", async () => {
    await addPayment({ amount: 100 });

    const { error } = await admin
      .from("projects")
      .delete()
      .eq("id", TARGET.projectId);

    expect(error).not.toBeNull();
    expect(error!.code).toBe("23503");
  });

  it("физическое удаление оплаты возможно (это не запрещено схемой)", async () => {
    // Запрет каскада защищает РОДИТЕЛЕЙ, а не саму запись: штатное удаление
    // оплаты — мягкое (`deleted_at`), но уборка строки, созданной в обход кода,
    // должна быть возможна.
    const { result } = await addPayment({ amount: 100 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { error } = await admin
      .from("spec_item_payments")
      .delete()
      .eq("id", result.payment.id);

    expect(error).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/*  2. Идемпотентность                                                 */
/* ------------------------------------------------------------------ */

describe("идемпотентность", () => {
  it("повтор запроса с тем же ключом возвращает уже созданную запись", async () => {
    const key = crypto.randomUUID();
    const first = await addPayment({ amount: 2500, key });
    const second = await addPayment({ amount: 2500, key });

    expect(first.result.ok && second.result.ok).toBe(true);
    if (!first.result.ok || !second.result.ok) return;

    expect(second.result.existing).toBe(true);
    expect(second.result.payment.id).toBe(first.result.payment.id);

    const { data } = await admin
      .from("spec_item_payments")
      .select("id")
      .eq("idempotency_key", key);
    expect(data).toHaveLength(1);
  });

  it("прямая вставка с занятым ключом отвергается уникальным индексом", async () => {
    const key = crypto.randomUUID();
    await addPayment({ amount: 100, key });

    const { error } = await admin.from("spec_item_payments").insert({
      org_id: TARGET.orgId,
      project_id: TARGET.projectId,
      spec_item_id: TARGET.specItemId,
      kind: "payment",
      amount: 100,
      comment: `ДУБЛЬ КЛЮЧА ${MARK}`,
      idempotency_key: key,
    });

    expect(error).not.toBeNull();
    // 23505 — тот самый отказ, который ядро разбирает как «запись уже есть».
    expect(error!.code).toBe("23505");
  });

  it("повтор с другим телом отвергается, а не выдаёт чужую запись", async () => {
    const key = crypto.randomUUID();
    await addPayment({ amount: 100, key });
    const second = await addPayment({ amount: 200, key });

    expect(second.result.ok).toBe(false);
    if (second.result.ok) return;
    expect(second.result.error.code).toBe("IDEMPOTENCY_CONFLICT");
  });
});

/* ------------------------------------------------------------------ */
/*  3. Ядро на живой БД                                                */
/* ------------------------------------------------------------------ */

describe("ядро: запись, список, правка, отмена", () => {
  it("оплата записывается, читается и попадает в журнал живым CHECK", async () => {
    const plan = await addPlan({ amount: 10000 });
    const { result } = await addPayment({ amount: 4000, planId: plan.id });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const listed = await listPayments(admin, baseArgs);
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    const entry = listed.payments.find((row) => row.id === result.payment.id);
    expect(entry).toMatchObject({
      kind: "payment",
      amount: 4000,
      paymentPlanId: plan.id,
      authorName: "Проверка оплат (тест)",
    });

    // Ядро события НЕ пишет — их пишет server action. Тест делает тот же шаг:
    // запись события проверяется против ЖИВОГО CHECK, который и есть предмет.
    expect(result.events).toHaveLength(1);
    expect(result.events[0].kind).toBe("payment_added");
    await recordSpecItemEvents(admin, result.events);

    const { data, error } = await admin
      .from("spec_item_events")
      .select("id, payload")
      .eq("spec_item_id", TARGET.specItemId)
      .eq("kind", "payment_added")
      .order("created_at", { ascending: false })
      .limit(1);

    expect(error).toBeNull();
    expect(
      (data as { payload: Record<string, unknown> }[])[0].payload,
    ).toMatchObject({
      payment_id: result.payment.id,
      payment_kind: "payment",
      amount: 4000,
      plan_id: plan.id,
    });
  });

  it("правка собирает таблицу изменений и пишет её в журнал", async () => {
    const { result } = await addPayment({ amount: 1000 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const updated = await updatePayment(admin, {
      ...baseArgs,
      actor,
      paymentId: result.payment.id,
      data: {
        kind: "payment",
        amount: 1750,
        paidAt: "2026-10-07",
        paymentPlanId: null,
        comment: `ПРАВКА ${MARK}`,
      },
    });

    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    expect(updated.payment.amount).toBe(1750);

    const row = await paymentRow(result.payment.id);
    // `numeric` через PostgREST приходит числом: строка "1750.00" — это `psql`,
    // а не Data API.
    expect(row!.amount).toBe(1750);
    expect(row!.paid_at).toBe("2026-10-07");

    await recordSpecItemEvents(admin, updated.events);
    const { data } = await admin
      .from("spec_item_events")
      .select("payload")
      .eq("spec_item_id", TARGET.specItemId)
      .eq("kind", "payment_changed")
      .order("created_at", { ascending: false })
      .limit(1);

    expect(
      (data as { payload: { changes: unknown } }[])[0].payload.changes,
    ).toEqual(
      expect.arrayContaining([
        { field: "amount", from: 1000, to: 1750 },
        { field: "paid_at", from: expect.any(String), to: "2026-10-07" },
      ]),
    );
  });

  it("отмена мягко скрывает запись, событие принимается живым CHECK", async () => {
    const { result } = await addPayment({ amount: 3000 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const removed = await removePayment(admin, {
      ...baseArgs,
      actor,
      paymentId: result.payment.id,
    });

    expect(removed.ok).toBe(true);
    if (!removed.ok) return;
    expect(removed.deleted).toBe(true);

    const row = await paymentRow(result.payment.id);
    expect(row!.deleted_at).not.toBeNull();

    const listed = await listPayments(admin, baseArgs);
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.payments.map((p) => p.id)).not.toContain(result.payment.id);

    await recordSpecItemEvents(admin, removed.events);
    const { data } = await admin
      .from("spec_item_events")
      .select("payload")
      .eq("spec_item_id", TARGET.specItemId)
      .eq("kind", "payment_removed")
      .order("created_at", { ascending: false })
      .limit(1);

    expect(
      (data as { payload: { payment_id: string } }[])[0].payload.payment_id,
    ).toBe(result.payment.id);
  });

  it("строку графика с неудалённой оплатой удалить нельзя (решение Q9)", async () => {
    const plan = await addPlan({ title: `ЗАПРЕТ УДАЛЕНИЯ ${MARK}` });
    const { result } = await addPayment({ amount: 1000, planId: plan.id });
    expect(result.ok).toBe(true);

    // Ядро отказывает: иначе оплата осталась бы в покрытии строки, которой нет.
    const blocked = await removePaymentPlan(admin, {
      ...baseArgs,
      actor,
      planId: plan.id,
    });

    expect(blocked.ok).toBe(false);
    if (blocked.ok) return;
    expect(blocked.error.message).toContain("оплат");

    // Строка и оплата на месте.
    const { data: planRow } = await admin
      .from("spec_item_payment_plans")
      .select("deleted_at")
      .eq("id", plan.id)
      .maybeSingle();
    expect(planRow!.deleted_at).toBeNull();

    const counts = await hasActivePayments(admin, {
      ...baseArgs,
      planId: plan.id,
    });
    expect(counts.ok).toBe(true);
    if (!counts.ok) return;
    expect(counts.count).toBe(1);

    // Отмена оплаты освобождает строку: история не теряется, но и не держит
    // график навсегда.
    if (!result.ok) return;
    await removePayment(admin, { ...baseArgs, actor, paymentId: result.payment.id });

    const removed = await removePaymentPlan(admin, {
      ...baseArgs,
      actor,
      planId: plan.id,
    });
    expect(removed.ok).toBe(true);
  });

  it("чужая организация не видит и не правит оплаты", async () => {
    const { result } = await addPayment({ amount: 500 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const foreignArgs = { orgId: OTHER_ORG, specItemId: TARGET.specItemId };

    const list = await listPayments(admin, foreignArgs);
    const update = await updatePayment(admin, {
      ...foreignArgs,
      actor,
      paymentId: result.payment.id,
      data: {
        kind: "payment",
        amount: 1,
        paidAt: null,
        paymentPlanId: null,
        comment: null,
      },
    });
    const remove = await removePayment(admin, {
      ...foreignArgs,
      actor,
      paymentId: result.payment.id,
    });

    for (const outcome of [list, update, remove]) {
      expect(outcome.ok).toBe(false);
      if (outcome.ok) continue;
      expect(outcome.error.code).toBe("NOT_FOUND");
    }

    const row = await paymentRow(result.payment.id);
    expect(row!.amount).toBe(500);
    expect(row!.deleted_at).toBeNull();
  });

  it("оплата чужой позиции не правится через свою", async () => {
    const { result } = await addPayment({ amount: 500 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const updated = await updatePayment(admin, {
      orgId: TARGET.orgId,
      specItemId: NEIGHBOUR_ITEM,
      actor,
      paymentId: result.payment.id,
      data: {
        kind: "payment",
        amount: 1,
        paidAt: null,
        paymentPlanId: null,
        comment: null,
      },
    });

    expect(updated.ok).toBe(false);
    if (updated.ok) return;
    expect(updated.error.code).toBe("NOT_FOUND");
  });
});

/* ------------------------------------------------------------------ */
/*  4. Главное правило этапа: стоимость не влияет на суммы             */
/* ------------------------------------------------------------------ */

describe("цена и количество не влияют на сохранённые суммы", () => {
  it("изменение цены и количества позиции не трогает ни график, ни оплаты", async () => {
    const plan = await addPlan({ amount: 10000 });
    const { result } = await addPayment({ amount: 4000, planId: plan.id });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Снимок «до»: сумма строки графика и сумма оплаты.
    const plansBefore = await listPaymentPlans(admin, baseArgs);
    const paymentsBefore = await listPayments(admin, baseArgs);
    expect(plansBefore.ok && paymentsBefore.ok).toBe(true);
    if (!plansBefore.ok || !paymentsBefore.ok) return;

    const { data: itemBefore } = await admin
      .from("spec_items")
      .select("price, qty")
      .eq("id", TARGET.specItemId)
      .maybeSingle();

    // Меняем стоимость позиции тем же способом, что интерфейс: правка колонок.
    const newPrice = Number(itemBefore?.price ?? 0) + 1234.56;
    const newQty = Number(itemBefore?.qty ?? 0) + 7;

    const { error: patchError } = await admin
      .from("spec_items")
      .update({ price: newPrice, qty: newQty })
      .eq("id", TARGET.specItemId);
    expect(patchError).toBeNull();

    try {
      const plansAfter = await listPaymentPlans(admin, baseArgs);
      const paymentsAfter = await listPayments(admin, baseArgs);
      expect(plansAfter.ok && paymentsAfter.ok).toBe(true);
      if (!plansAfter.ok || !paymentsAfter.ok) return;

      // Каждая сумма и каждая строка — те же: между стоимостью и платежами нет
      // ни FK, ни триггера, ни вычисляемой колонки (REPORT §6.2).
      expect(plansAfter.plans.find((p) => p.id === plan.id)).toEqual(
        plansBefore.plans.find((p) => p.id === plan.id),
      );
      expect(paymentsAfter.payments.find((p) => p.id === result.payment.id)).toEqual(
        paymentsBefore.payments.find((p) => p.id === result.payment.id),
      );

      // И сводка, посчитанная из этих строк, не сдвинулась ни на копейку:
      // суммы те же, что и до правки стоимости позиции.
      const planRows = plansAfter.plans.map((entry) => ({
        id: entry.id,
        amount: entry.amount,
        position: entry.position,
        deletedAt: null,
      }));
      const paymentRows = paymentsAfter.payments.map((entry) => ({
        paymentPlanId: entry.paymentPlanId,
        amount: entry.amount,
        kind: entry.kind,
        deletedAt: null,
      }));

      expect(summarisePaymentSchedule(planRows, paymentRows)).toEqual(
        summarisePaymentSchedule(
          plansBefore.plans.map((entry) => ({
            id: entry.id,
            amount: entry.amount,
            position: entry.position,
            deletedAt: null,
          })),
          paymentsBefore.payments.map((entry) => ({
            paymentPlanId: entry.paymentPlanId,
            amount: entry.amount,
            kind: entry.kind,
            deletedAt: null,
          })),
        ),
      );
    } finally {
      // Стоимость позиции возвращается в исходное значение: тест не оставляет
      // за собой продуктовых правок.
      await admin
        .from("spec_items")
        .update({ price: itemBefore?.price ?? 0, qty: itemBefore?.qty ?? 0 })
        .eq("id", TARGET.specItemId);
    }
  });
});

/* ------------------------------------------------------------------ */
/*  5. RLS через Data API                                              */
/* ------------------------------------------------------------------ */

describe("security: RLS Data API", () => {
  it("anon не читает оплаты (политика выдана только authenticated)", async () => {
    await addPayment({ amount: 100 });

    const { data } = await anon
      .from("spec_item_payments")
      .select("id, amount")
      .limit(5);

    expect(data ?? []).toEqual([]);
  });

  it("anon не может вставить оплату", async () => {
    const { error } = await anon.from("spec_item_payments").insert({
      org_id: TARGET.orgId,
      project_id: TARGET.projectId,
      spec_item_id: TARGET.specItemId,
      kind: "payment",
      amount: 1,
      comment: `ANON ${MARK}`,
    });

    expect(error).not.toBeNull();
  });
});
