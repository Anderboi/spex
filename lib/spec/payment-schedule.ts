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
  /**
   * Вид записи. `undefined` — оплата: так вызывающий, которому вид ещё не
   * известен (покрытие строки в первой задаче этапа), не обязан его выдумывать,
   * а незнакомое значение читается как оплата — та же граница, что у CHECK
   * «вид записи только payment или refund».
   */
  kind?: PaymentRecordKind;
  /** Мягкое удаление: `null` или `undefined` — запись активна. */
  deletedAt?: string | null;
};

/** Вид записи о деньгах: оплата или возврат (решение O1). */
export type PaymentRecordKind = "payment" | "refund";

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
  /**
   * Σ фактов: оплаты минус возвраты. Возврат уменьшает оплаченное, но виден и
   * отдельной величиной `refunded` — иначе уменьшение оплаты выглядело бы как
   * правка истории, а не как отдельное событие.
   */
  paid: number;
  /** Σ возвратов, справочно. Возврат входит в `paid` со знаком минус. */
  refunded: number;
  /**
   * `planned − paid`: больше нуля — осталось. Отрицательным НЕ бывает:
   * превышение факта над планом показывает `overpaid`, а отрицательный остаток
   * читался бы как «ещё должны −2 000 ₽» и в пустом графике выглядел бы
   * переплатой на 100 % (REPORT §5.1(5)).
   */
  remaining: number;
  /**
   * Превышение факта над планом. Показывается только при НЕПУСТОМ графике:
   * при `planned = 0` оплата считается оплатой вне графика, а не переплатой на
   * все сто процентов.
   */
  overpaid: number;
  /**
   * Сколько денег прошло ВНЕ графика: оплаты и возвраты без строки плана.
   * Показывается отдельной строкой — иначе оплата без плана читалась бы как
   * покрытие первой попавшейся строки.
   */
  unplanned: number;
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
 * Денежная сумма: округление до копейки на границе расчёта.
 *
 * Суммы приходят из `numeric(12,2)`, то есть уже с двумя знаками, но их
 * СЛОЖЕНИЕ идёт в двоичной плавающей точке: `0.1 + 0.2` даёт
 * `0.30000000000000004`. В БД агрегат считается над `numeric`
 * (`coalesce(sum(...))`, REPORT §5.1), поэтому единственное место, где может
 * появиться расхождение, — эта арифметика. Округление здесь повторяет то, что
 * вернул бы SQL, и убирает артефакт до того, как он станет подписью в интерфейсе
 * или строкой сравнения.
 *
 * `round2` — не «форматирование»: форматирует `fmtRub`. Это часть правила
 * «деньги считаются один раз и до копейки».
 */
export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Мягко удалённая запись вычитается из всех сумм: её больше нет. */
function activeMoneyRows<
  T extends { amount: number | string; deletedAt?: string | null },
>(rows: readonly T[]): T[] {
  return rows.filter((row) => (row.deletedAt ?? null) === null);
}

/**
 * Сводка по позиции: план, оплачено, возвраты, остаток, переплата и оплаты вне
 * графика.
 *
 * ── Правила (REPORT §5.1) ──────────────────────────────────────────────────
 *
 * 1. **План — не оплата.** `planned` и `paid` — разные величины: они не
 *    вычитаются при записи и не подменяют друг друга. Стоимость позиции
 *    (`price × qty`) во вход не входит вовсе: вывести из неё сумму нечем.
 * 2. **Частичные оплаты допустимы.** Несколько фактов складываются в `paid`, и
 *    каждый из них отдельно виден в `paymentPlanCoverage`.
 * 3. **Возврат уменьшает оплаченное и виден отдельно** (`refunded`).
 * 4. **Оплата без плана разрешена** и попадает в `paid`, но не в покрытие
 *    строк; её величина — `unplanned`.
 * 5. **Переплата показывается явно**, но только при непустом графике: при
 *    `planned = 0` факт — это «оплачено вне графика», и `remaining` в этом
 *    случае равен нулю, а не отрицательной сумме факта.
 * 6. **Мягко удалённые строки исключаются** из обеих сумм. Удаление СТРОКИ
 *    ГРАФИКА не превращает её оплаты во «вне графика»: факт остаётся фактом
 *    (`paid`), но строка в `planned` уже не входит — так же считает и SQL из
 *    REPORT §5.1, где оба агрегата фильтруются по `deleted_at is null` в своих
 *    таблицах.
 *
 * `paidRows` по умолчанию пуст — у вызывающего может не быть фактов вовсе.
 */
export function summarisePaymentSchedule(
  plans: readonly PaymentPlanLike[],
  paidRows: readonly PaidAmountLike[] = [],
): PaymentScheduleSummary {
  const active = paymentPlanRows(plans);
  const facts = activeMoneyRows(paidRows);

  const payment = (row: PaidAmountLike) =>
    (row.kind ?? "payment") === "payment";
  const amountOf = (row: PaidAmountLike) => toAmount(row.amount);
  /** Сумма выборки; пустая выборка — ноль, а не `NaN`. */
  const sumOf = (rows: PaidAmountLike[], where: (row: PaidAmountLike) => boolean) =>
    roundMoney(rows.reduce((sum, row) => (where(row) ? sum + amountOf(row) : sum), 0));

  const planned = roundMoney(
    active.reduce((sum, plan) => sum + toAmount(plan.amount), 0),
  );
  const refunded = sumOf(facts, (row) => !payment(row));
  const paidGross = sumOf(facts, payment);
  const paid = roundMoney(paidGross - refunded);
  const unplanned = roundMoney(
    sumOf(facts, (row) => payment(row) && row.paymentPlanId === null) -
      sumOf(facts, (row) => !payment(row) && row.paymentPlanId === null),
  );

  /**
   * Пустой график — не «остаток в минус», а отсутствие обязательств: всё
   * оплаченное тогда показано строкой «вне графика», и отрицательный остаток
   * рядом с нулевой переплатой читался бы как переплата на 100 % — то есть
   * ровно то, что правило границы запрещает.
   *
   * Непустой график остаток в минус тоже не уводит: превышение показывает
   * `overpaid`, а «осталось» и «переплатили» — две разные строки одного места
   * (то же решение, что у остатка по строке в `paymentPlanCoverage`).
   */
  const remaining = active.length > 0 ? Math.max(roundMoney(planned - paid), 0) : 0;

  return {
    planned,
    paid,
    refunded,
    remaining,
    overpaid: active.length > 0 ? Math.max(roundMoney(paid - planned), 0) : 0,
    unplanned,
    hasPlan: active.length > 0,
  };
}

/**
 * Покрытие каждой активной строки графика: сколько по ней оплачено и сколько
 * осталось.
 *
 * Частичные оплаты складываются: несколько фактов могут ссылаться на одну
 * строку. Возврат по строке уменьшает её покрытие — иначе возврат выглядел бы
 * как оплата, а остаток по строке оставался бы заниженным навсегда. Мягко
 * удалённый факт не считается: его нет ни в покрытии, ни в сумме.
 *
 * Факты без строки (оплата вне графика) в покрытие не попадают — у них нет
 * строки, к которой их отнести, и приписывать их первой попавшейся строке
 * значило бы показывать неправду.
 */
export function paymentPlanCoverage(
  plans: readonly PaymentPlanLike[],
  paidRows: readonly PaidAmountLike[] = [],
): Map<string, PaymentPlanCoverage> {
  const active = paymentPlanRows(plans);
  const paidByPlan = new Map<string, number>();

  for (const row of activeMoneyRows(paidRows)) {
    if (row.paymentPlanId === null) continue;
    // Возврат входит со знаком минус — тем же правилом, что в сводке
    // (`paid = оплаты − возвраты`); третьей формулы «сколько заплачено» быть не
    // должно.
    const signed = (row.kind ?? "payment") === "payment"
      ? toAmount(row.amount)
      : -toAmount(row.amount);
    paidByPlan.set(
      row.paymentPlanId,
      (paidByPlan.get(row.paymentPlanId) ?? 0) + signed,
    );
  }

  const coverage = new Map<string, PaymentPlanCoverage>();

  for (const plan of active) {
    const amount = toAmount(plan.amount);
    const paid = roundMoney(paidByPlan.get(plan.id) ?? 0);
    coverage.set(plan.id, {
      paid,
      remaining: Math.max(roundMoney(amount - paid), 0),
      overpaid: Math.max(roundMoney(paid - amount), 0),
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
