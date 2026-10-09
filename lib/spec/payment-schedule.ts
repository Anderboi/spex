/**
 * График платежей позиции как арифметика и порядок: чистые функции без React,
 * без клиента БД и без формата ответа для клиента.
 *
 * ── Зачем отдельный модуль ─────────────────────────────────────────────────
 *
 * Ровно по той же причине, по которой существуют `./service-operation-deadline`
 * и `./history-mappers`: правила графика — это то, что должно быть проверено без
 * Next и без живой БД. Запросы и права живут в `./payment-plan-mutations` и
 * `actions/spec-item-payment-plans.ts`, а здесь остаётся арифметика, которую
 * используют и вкладка «Платежи», и (следующей задачей) строка оплат в воронке.
 *
 * ── Главное правило ────────────────────────────────────────────────────────
 *
 * **Плановый платёж не является оплатой.** `planned` (сумма графика) и `paid`
 * (сумма фактов) — разные величины: они не вычитаются при записи, не подменяют
 * друг друга и не выводятся из стоимости позиции. Цена, количество и скидки
 * позиции в этот модуль не приходят вовсе — вывести из них сумму графика
 * структурно нечем (ADR docs/adr/0003-grafik-platezhey-eto-samostoyatelnyy-fakt.md).
 *
 * ── Мягко удалённые строки ─────────────────────────────────────────────────
 *
 * `deleted_at` исключает строку из суммы, из порядка и из покрытия: удалённая
 * строка графика — не обязательство. В журнале событий она при этом остаётся
 * (журнал append-only).
 *
 * ── Почему суммы принимаются строкой ───────────────────────────────────────
 *
 * PostgREST отдаёт `numeric` строкой, чтобы не терять точность. Складывать
 * такие значения как строки нельзя (`"1000.50" + "12.25"` склеило бы текст), а
 * приводить их в SQL-запросе — значит иметь две формулы суммы. Поэтому
 * `amount` объявлен как `number | string`, и приведение живёт здесь, в одном
 * месте на весь график.
 */

/** Строка графика: структурный минимум, который нужен арифметике. */
export type PaymentPlanLike = {
  id: string;
  /** Сумма плана. Postgres отдаёт `numeric` строкой, приложение — числом. */
  amount: number | string;
  /** Порядок отображения. Уникален среди неудалённых строк позиции. */
  position: number;
  /** Мягкое удаление: `null` — строка активна. */
  deletedAt: string | null;
};

/** Факт оплаты: для графика важны сумма и то, к какой строке он привязан. */
export type PaidAmountLike = {
  /** Строка графика; `null` — оплата вне графика. */
  paymentPlanId: string | null;
  amount: number | string;
};

/* ------------------------------------------------------------------ */
/*  Перестановка                                                       */
/* ------------------------------------------------------------------ */

/**
 * Порядок строк графика после перестановки одной из них.
 *
 * ── Почему перестановка не выполняется здесь ──────────────────────────────
 *
 * Обмен номерами ДВУХ строк невозможен серией запросов: частичный уникальный
 * индекс `(spec_item_id, position)` проверяется построчно, поэтому строка,
 * которой первым назначают занятый номер, упирается в индекс. Это выяснилось на
 * живой БД, и поэтому обмен целиком живёт в одной транзакции —
 * `move_spec_item_payment_plan` (миграция 20261009_001), которую вызывает
 * `./payment-plan-mutations`.
 *
 * Модуль оставляет себе только чистую часть правила: какая
 * последовательность получается после перестановки. Она нужна и тестам (края
 * списка проверяются без БД), и документации порядка: `orderPaymentPlans` и
 * `movePaymentPlan` — одно правило сортировки, а не два.
 */

/** Строка графика — только идентификатор и порядок (для перестановки). */
export type PaymentPlanOrderRow = { id: string; position: number };

/** Куда переставляется строка. */
export type PaymentPlanMoveDirection = "up" | "down";

/** Сводка по графику позиции. */
export type PaymentScheduleSummary = {
  /** Σ сумм активных строк графика. Стоимость позиции в это не входит. */
  planned: number;
  /** Σ фактов (в этой задаче — всегда 0: фактов ещё нет). */
  paid: number;
  /** `planned − paid`: больше нуля — осталось, меньше — переплата. */
  remaining: number;
  /**
   * Превышение факта над планом. Показывается только при НЕПУСТОМ графике:
   * при `planned = 0` оплата считается оплатой вне графика, а не переплатой на
   * все сто процентов.
   */
  overpaid: number;
  /** Есть ли в графике хотя бы одна активная строка. */
  hasPlan: boolean;
};

/** Покрытие одной строки графика фактами. */
export type PaymentPlanCoverage = {
  paid: number;
  /**
   * `amount − paid`, но не меньше нуля.
   *
   * Оговорка к REPORT §5.1(2), где остаток по строке назван могущим быть
   * отрицательным: в интерфейсе «осталось» и «переплатили» — две разные строки
   * одного места, и отрицательный остаток читался бы как «ещё должны −2 000 ₽».
   * Поэтому остаток не уходит в минус, а превышение показывает `overpaid`.
   */
  remaining: number;
  overpaid: number;
};

/**
 * Число из значения `numeric`.
 *
 * Нечисловое значение даёт 0, а не `NaN`: `NaN` отравил бы сумму всего графика,
 * а испорченная строка не должна ломать вкладку целиком. Отрицательная сумма в
 * БД невозможна (`check (amount > 0)`), поэтому отдельной ветки под неё нет —
 * а если такая строка появится, она честно уменьшит сумму.
 *
 * Экспортируется: этим же приведением пользуется запись графика
 * (`./payment-plan-mutations`), и вторая копия правила разошлась бы с первой.
 */
export function toAmount(value: number | string): number {
  const num = typeof value === "number" ? value : Number(value);
  return Number.isFinite(num) ? num : 0;
}

/**
 * Активные строки графика: без мягко удалённых.
 *
 * Отдельная функция, потому что «строка удалена» — одно правило, а читателей у
 * него три: сумма, порядок и покрытие.
 */
export function paymentPlanRows<T extends PaymentPlanLike>(
  plans: readonly T[],
): T[] {
  return plans.filter((plan) => plan.deletedAt === null);
}

/**
 * Порядок отображения графика: по `position`, при равенстве — по `id`.
 *
 * `position` уникален среди неудалённых строк позиции (частичный уникальный
 * индекс), поэтому второй ключ — не «второе правило сортировки», а страховка от
 * исторических строк и от строки, попавшей в БД в обход индекса. Тот же приём,
 * что в сортировке ленты (`created_at`, затем `id`).
 */
export function orderPaymentPlans<T extends PaymentPlanLike>(
  plans: readonly T[],
): T[] {
  return paymentPlanRows(plans).sort((a, b) =>
    a.position === b.position
      ? a.id < b.id
        ? -1
        : a.id > b.id
          ? 1
          : 0
      : a.position - b.position,
  );
}

/**
 * Сводка по графику позиции.
 *
 * `paidRows` по умолчанию пуст: в этой задаче фактических оплат ещё нет, а
 * сигнатура уже та, которой будет пользоваться следующая. `planned = 0` — не
 * «график целиком не оплачен»: это отсутствие графика, и правило границы
 * (`overpaid`) именно об этом.
 */
export function summarisePaymentSchedule(
  plans: readonly PaymentPlanLike[],
  paidRows: readonly PaidAmountLike[] = [],
): PaymentScheduleSummary {
  const active = paymentPlanRows(plans);

  const planned = active.reduce((sum, plan) => sum + toAmount(plan.amount), 0);
  const paid = paidRows.reduce((sum, row) => sum + toAmount(row.amount), 0);

  return {
    planned,
    paid,
    remaining: planned - paid,
    overpaid: active.length > 0 ? Math.max(paid - planned, 0) : 0,
    hasPlan: active.length > 0,
  };
}

/**
 * Покрытие каждой активной строки графика: сколько по ней оплачено и сколько
 * осталось.
 *
 * Частичные оплаты складываются: несколько фактов могут ссылаться на одну
 * строку. Факты без строки (оплата вне графика) в покрытие не попадают — у них
 * нет строки, к которой их отнести, и приписывать их первой попавшейся строке
 * значило бы показывать неправду.
 */
export function paymentPlanCoverage(
  plans: readonly PaymentPlanLike[],
  paidRows: readonly PaidAmountLike[] = [],
): Map<string, PaymentPlanCoverage> {
  const active = paymentPlanRows(plans);
  const paidByPlan = new Map<string, number>();

  for (const row of paidRows) {
    if (row.paymentPlanId === null) continue;
    paidByPlan.set(
      row.paymentPlanId,
      (paidByPlan.get(row.paymentPlanId) ?? 0) + toAmount(row.amount),
    );
  }

  const coverage = new Map<string, PaymentPlanCoverage>();

  for (const plan of active) {
    const amount = toAmount(plan.amount);
    const paid = paidByPlan.get(plan.id) ?? 0;
    coverage.set(plan.id, {
      paid,
      remaining: Math.max(amount - paid, 0),
      overpaid: Math.max(paid - amount, 0),
    });
  }

  return coverage;
}

/** Индекс строки в уже упорядоченном списке; `-1` — строки в графике нет. */
export function findPaymentPlanPosition(
  ordered: readonly PaymentPlanOrderRow[],
  planId: string,
): number {
  return ordered.findIndex((row) => row.id === planId);
}

/**
 * Порядок строк графика после перестановки одной из них.
 *
 * Возвращается именно ПОСЛЕДОВАТЕЛЬНОСТЬ идентификаторов, а не список строк:
 * проверять края списка удобнее по ней, а записывать обмен номерами будет
 * транзакционная функция БД (см. заголовок секции выше) — здесь только правило
 * порядка.
 *
 * `null` — переставлять нечего: строка первая (вверх), последняя (вниз) или её
 * вовсе нет в графике. Отсутствие действия — не ошибка пользователя: у крайних
 * строк кнопка перестановки просто не работает.
 */
export function movePaymentPlan(
  rows: readonly PaymentPlanOrderRow[],
  planId: string,
  direction: PaymentPlanMoveDirection,
): string[] | null {
  const ordered = [...rows].sort((a, b) =>
    a.position === b.position
      ? a.id < b.id
        ? -1
        : a.id > b.id
          ? 1
          : 0
      : a.position - b.position,
  );

  const at = findPaymentPlanPosition(ordered, planId);
  if (at === -1) return null;

  const to = direction === "up" ? at - 1 : at + 1;
  if (to < 0 || to >= ordered.length) return null;

  const ids = ordered.map((row) => row.id);
  [ids[at], ids[to]] = [ids[to], ids[at]];
  return ids;
}
