import { beforeEach, describe, expect, it, vi } from "vitest";
import { addPaymentPlan } from "./payment-plan-mutations";

/**
 * Гонка двух одновременных добавлений в график.
 *
 * Файл намеренно короткий: он проверяет ровно один контракт — нарушение
 * уникальности номера порядка (`23505`) приводит к ОДНОМУ повтору с
 * пересчитанным номером, а не к отказу пользователю.
 *
 * Остальное ядро покрыто `./payment-plan-mutations.test.ts` на полном подставном
 * клиенте. Здесь клиент собран вручную, потому что управлять нужно не состоянием
 * таблиц, а последовательностью ошибок БД.
 */

const ORG = "11111111-1111-4111-8111-111111111111";
const PROJECT = "22222222-2222-4222-8222-222222222222";
const ITEM = "33333333-3333-4333-8333-333333333333";

const ACTOR = { id: "user-1", name: "Анна", email: null };

const DATA = {
  title: "Платёж",
  amount: 100,
  condition: null,
  dueDate: null,
};

/** Ошибка PostgREST при нарушении уникального индекса порядка. */
const UNIQUE_VIOLATION = {
  code: "23505",
  message:
    'duplicate key value violates unique constraint "spec_item_payment_plans_position_uidx"',
  details: null,
  hint: null,
};

/**
 * Клиент, у которого первые `conflicts` вставок падают нарушением уникальности.
 *
 * Между попытками максимум порядка растёт — ровно как если бы параллельное
 * добавление заняло номер раньше нас. Поэтому успешная попытка обязана взять
 * номер БОЛЬШЕ первого: иначе повтор просто повторил бы конфликт.
 */
function racingClient(conflicts: number) {
  const inserts: Record<string, unknown>[] = [];
  let attempts = 0;
  let maxPosition = 0;

  function from(table: string) {
    if (table === "spec_items") {
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  id: ITEM,
                  org_id: ORG,
                  project_id: PROJECT,
                  deleted_at: null,
                },
                error: null,
              }),
            }),
          }),
        }),
      };
    }

    return {
      // Чтение максимума порядка перед вставкой.
      select: () => ({
        eq: () => ({
          eq: () => ({
            is: () => ({
              order: () => ({
                limit: async () => ({
                  data: [{ position: maxPosition }],
                  error: null,
                }),
              }),
            }),
          }),
        }),
      }),
      insert: (row: Record<string, unknown>) => {
        attempts += 1;
        const conflict = attempts <= conflicts;
        if (conflict) maxPosition += 1;
        else {
          inserts.push(row);
          maxPosition = Number(row.position);
        }

        return {
          select: () => ({
            single: async () =>
              conflict
                ? { data: null, error: UNIQUE_VIOLATION }
                : { data: { id: "plan-new", ...row }, error: null },
          }),
        };
      },
    };
  }

  return { client: { from } as never, inserts, attempts: () => attempts };
}

beforeEach(() => {
  // Ядро логирует отказ БД: шум в выводе теста не нужен.
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("addPaymentPlan: гонка двух добавлений", () => {
  it("при 23505 номер пересчитывается и попытка повторяется один раз", async () => {
    const racing = racingClient(1);

    const result = await addPaymentPlan(racing.client, {
      orgId: ORG,
      specItemId: ITEM,
      actor: ACTOR,
      data: DATA,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(racing.attempts()).toBe(2);
    expect(racing.inserts).toHaveLength(1);
    // Первая попытка метила в 0, но его занял конкурент (максимум стал 1).
    // Вторая обязана взять номер ПОСЛЕ перечитанного максимума, то есть 2:
    // повтор с прежним номером снова упёрся бы в тот же индекс.
    expect(racing.inserts[0].position).toBe(2);
    expect(result.plan.position).toBe(2);
  });

  it("второй конфликт подряд не повторяется: отказ уходит наверх", async () => {
    const racing = racingClient(2);

    const result = await addPaymentPlan(racing.client, {
      orgId: ORG,
      specItemId: ITEM,
      actor: ACTOR,
      data: DATA,
    });

    // «Повторяем до победного» маскировало бы другую причину отказа, поэтому
    // попыток ровно две.
    expect(racing.attempts()).toBe(2);
    expect(result.ok).toBe(false);
  });

  it("успешная вставка с первого раза повтора не делает", async () => {
    const racing = racingClient(0);

    const result = await addPaymentPlan(racing.client, {
      orgId: ORG,
      specItemId: ITEM,
      actor: ACTOR,
      data: DATA,
    });

    expect(result.ok).toBe(true);
    expect(racing.attempts()).toBe(1);
  });
});
