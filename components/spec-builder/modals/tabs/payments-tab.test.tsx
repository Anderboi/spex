import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import PaymentsTab from "./payments-tab";
import type { PaymentEntry } from "@/lib/spec/payment-types";
import type { PaymentPlanEntry } from "@/lib/spec/payment-plan-types";

/**
 * Тесты вкладки «Платежи»: пометка «возвратов больше, чем оплат».
 *
 * Server actions подменяются модульными моками: настоящие требуют сессии
 * next-auth и живой БД. Проверяется поведение вкладки — что состояние
 * «вернули больше, чем заплатили» пользователь видит явной пометкой, а не
 * только отрицательным числом в сводке.
 *
 * ── Почему проверяется именно пометка ──────────────────────────────────────
 *
 * Арифметика (суммы, остаток, покрытие) уже покрыта юнит-тестами
 * `lib/spec/payment-schedule.test.ts` и здесь не пересчитывается: тест,
 * повторяющий формулу, подтверждал бы сам себя. Здесь проверяется то, чего в
 * чистом модуле нет, — что признак `refundsExceedPayments` ДОХОДИТ до экрана.
 * Пометка ищется по роли `alert`, а не по классу: разметка — не контракт.
 */

const listPlansMock = vi.hoisted(() => vi.fn());
const listPaymentsMock = vi.hoisted(() => vi.fn());

vi.mock("@/actions/spec-item-payment-plans", () => ({
  listPaymentPlans: listPlansMock,
  createPaymentPlan: vi.fn(),
  updatePaymentPlan: vi.fn(),
  deletePaymentPlan: vi.fn(),
  movePaymentPlan: vi.fn(),
}));

vi.mock("@/actions/spec-item-payments", () => ({
  listPayments: listPaymentsMock,
  createPayment: vi.fn(),
  updatePayment: vi.fn(),
  deletePayment: vi.fn(),
}));

/** Строка графика. */
function plan(over: Partial<PaymentPlanEntry> = {}): PaymentPlanEntry {
  return {
    id: "plan-1",
    orgId: "org-1",
    projectId: "project-1",
    specItemId: "item-1",
    title: "Аванс 50 %",
    amount: 10000,
    condition: "Предоплата",
    dueDate: null,
    position: 0,
    authorId: "user-1",
    createdAt: "2026-10-01T10:00:00.000Z",
    updatedAt: "2026-10-01T10:00:00.000Z",
    ...over,
  };
}

/** Факт: оплата или возврат. */
function payment(over: Partial<PaymentEntry> = {}): PaymentEntry {
  return {
    id: "payment-1",
    orgId: "org-1",
    projectId: "project-1",
    specItemId: "item-1",
    kind: "payment",
    amount: 3000,
    paidAt: "2026-10-01",
    paymentPlanId: "plan-1",
    comment: null,
    authorId: "user-1",
    authorName: "Andy",
    codeSnapshot: null,
    nameSnapshot: null,
    projectTitleSnapshot: null,
    createdAt: "2026-10-01T10:00:00.000Z",
    updatedAt: "2026-10-01T10:00:00.000Z",
    ...over,
  };
}

/** Рендер вкладки с заданными ответами действий. */
function setup(over: {
  plans?: PaymentPlanEntry[];
  payments?: PaymentEntry[];
  /** Стоимость позиции — база прогресса. */
  itemCost?: number;
} = {}) {
  listPlansMock.mockResolvedValue({
    success: true,
    data: over.plans ?? [plan()],
  });
  listPaymentsMock.mockResolvedValue({
    success: true,
    data: over.payments ?? [],
  });

  render(
    <PaymentsTab
      orgSlug="acme"
      specItemId="item-1"
      role="owner"
      currentUserId="user-1"
      itemCost={over.itemCost ?? 10000}
    />,
  );
}

/**
 * Пометка о превышении возвратов.
 *
 * Ищется по роли и тексту, а не по доступному имени: `role="alert"` на `div` не
 * берёт имя из содержимого, и задавать `aria-label` с текстом, который и так
 * лежит внутри, значило бы заставить диктора произнести фразу дважды.
 */
const overRefundMarker = () => {
  const marker = screen
    .queryAllByRole("alert")
    .find((node) => node.textContent?.includes("Возвратов больше, чем оплачено"));

  return marker ?? null;
};

/**
 * Карточка прогресса: стоимость, оплачено, остаток.
 *
 * `data-testid` — по той же причине, что в модалке закупки: карточка это `div`
 * без роли и без единого текстового узла.
 */
const progressCard = () => screen.getByTestId("payments-progress");

/** Текст карточки с пробелами, приведёнными к обычным: `fmtRub` печатает
 * неразрывные, и сравнивать их с литералами теста нельзя. */
const progressText = () =>
  (progressCard().textContent ?? "").replace(/\s/g, " ");

/** Сумма как её печатает `fmtRub`, с обычными пробелами. */
const money = (value: number) =>
  Math.abs(value).toLocaleString("ru-RU").replace(/\s/g, " ");

beforeEach(() => {
  listPlansMock.mockReset();
  listPaymentsMock.mockReset();
});

afterEach(cleanup);

describe("PaymentsTab · прогресс от стоимости позиции", () => {
  it("показывает стоимость, оплаченное, остаток и процент", async () => {
    setup({
      payments: [payment({ id: "p-1", kind: "payment", amount: 4000 })],
      itemCost: 10000,
    });

    await waitFor(() => {
      expect(progressText()).toContain(money(4000));
    });

    expect(progressText()).toContain("Стоимость материала");
    expect(progressText()).toContain(money(10000));
    expect(progressText()).toContain("Осталось");
    expect(progressText()).toContain(money(6000));
    // 4000 из 10000 — 40 %.
    expect(progressText()).toContain("40 %");
  });

  it("полностью оплаченная позиция — 100 % и нулевой остаток", async () => {
    setup({
      payments: [payment({ id: "p-1", kind: "payment", amount: 10000 })],
      itemCost: 10000,
    });

    await waitFor(() => {
      expect(progressText()).toContain("100 %");
    });

    expect(progressText()).toContain("Осталось");
    expect(progressText()).toContain(money(0));
  });

  it("переплата показывается вместо остатка и не уводит процент выше 100", async () => {
    setup({
      payments: [payment({ id: "p-1", kind: "payment", amount: 12000 })],
      itemCost: 10000,
    });

    await waitFor(() => {
      expect(progressText()).toContain("Переплата");
    });

    expect(progressText()).toContain(money(2000));
    expect(progressText()).toContain("100 %");
    // Остатка при переплате нет: две подписи одного места противоречили бы друг
    // другу.
    expect(progressText()).not.toContain("Осталось");
  });

  it("возвраты уменьшают оплаченное и видны отдельной строкой", async () => {
    setup({
      payments: [
        payment({ id: "p-1", kind: "payment", amount: 6000 }),
        payment({ id: "r-1", kind: "refund", amount: 1000 }),
      ],
      itemCost: 10000,
    });

    await waitFor(() => {
      expect(progressText()).toContain("Возвраты");
    });

    // 6000 − 1000 = 5000 из 10000 — половина.
    expect(progressText()).toContain(money(5000));
    expect(progressText()).toContain("50 %");
  });

  it("позиция без цены: процента нет, а не деление на ноль", async () => {
    setup({
      payments: [payment({ id: "p-1", kind: "payment", amount: 5000 })],
      itemCost: 0,
    });

    await waitFor(() => {
      expect(progressText()).toContain("Стоимость материала");
    });

    // Ни «Infinity %», ни «NaN %», ни ложного «0 %».
    expect(progressText()).not.toContain("Infinity");
    expect(progressText()).not.toContain("NaN");
    expect(progressText()).not.toContain("%");
  });

  it("блок графика платежей не показывается вовсе", async () => {
    // Решение интервью 2026-10-10: график выведен из интерфейса, данные и код
    // сохранены. Проверяется именно отсутствие входа в него — кнопки и таблицы.
    setup({
      plans: [plan()],
      payments: [payment({ id: "p-1", kind: "payment", amount: 4000 })],
      itemCost: 10000,
    });

    await waitFor(() => {
      expect(progressText()).toContain(money(4000));
    });

    expect(screen.queryByText(/Строк в графике/)).toBeNull();
    expect(screen.queryByText(/Добавить платёж/)).toBeNull();
    expect(screen.queryByText(/^Аванс/)).toBeNull();
    expect(screen.queryByText(/Платежей пока нет/)).toBeNull();
  });
});

describe("PaymentsTab · возвратов больше, чем оплат", () => {
  it("пометка показана, когда возвраты превышают оплаты", async () => {
    setup({
      payments: [
        payment({ id: "p-1", kind: "payment", amount: 3000 }),
        payment({ id: "r-1", kind: "refund", amount: 5000 }),
      ],
    });

    // Загрузка асинхронная: ждём, пока вкладка получит факты.
    await waitFor(() => {
      expect(screen.getByText("Оплат и возвратов: 2")).toBeDefined();
    });

    expect(overRefundMarker()).not.toBeNull();
  });

  it("пометка объясняет, что это состояние, а не ошибка ввода", async () => {
    setup({
      payments: [
        payment({ id: "p-1", kind: "payment", amount: 1000 }),
        payment({ id: "r-1", kind: "refund", amount: 4000 }),
      ],
    });

    await waitFor(() => {
      expect(screen.getByText("Оплат и возвратов: 2")).toBeDefined();
    });

    const marker = overRefundMarker();
    expect(marker).not.toBeNull();

    // Случай не запрещён (решение Q13): причина не требуется, запись уже
    // сохранена. Поэтому текст говорит, что это состояние, а не ошибка ввода,
    // — иначе пользователь искал бы, что он сделал не так.
    //
    // Проверяется тело пометки ВНУТРИ неё: та же формулировка в другом месте
    // страницы контрактом не является.
    expect(
      within(marker as HTMLElement).getByText(/Запись сохранена/),
    ).toBeDefined();
  });

  it("пометка называет оплаченное и возвращённое, а не переворачивает их", async () => {
    // Формулировка — часть требования: пометка объясняет ОТРИЦАТЕЛЬНОЕ
    // «Оплачено». Сказать «оплачено больше, чем получено» в случае, когда
    // вернули больше, значит добавить второе противоречащее утверждение.
    setup({
      payments: [
        payment({ id: "p-1", kind: "payment", amount: 1000 }),
        payment({ id: "r-1", kind: "refund", amount: 4000 }),
      ],
    });

    await waitFor(() => {
      expect(screen.getByText("Оплат и возвратов: 2")).toBeDefined();
    });

    const marker = overRefundMarker() as HTMLElement;

    // Числа берутся из сводки, а не восстанавливаются как `paid + refunded`.
    expect(within(marker).getByText(/1 000 ₽/)).toBeDefined();
    expect(within(marker).getByText(/4 000 ₽/)).toBeDefined();
    expect(within(marker).getByText(/вернули больше, чем получили/)).toBeDefined();
  });

  it("равные возвраты и оплаты пометки не дают", async () => {
    setup({
      payments: [
        payment({ id: "p-1", kind: "payment", amount: 5000 }),
        payment({ id: "r-1", kind: "refund", amount: 5000 }),
      ],
    });

    await waitFor(() => {
      expect(screen.getByText("Оплат и возвратов: 2")).toBeDefined();
    });

    expect(overRefundMarker()).toBeNull();
  });

  it("возвраты меньше оплат пометки не дают", async () => {
    setup({
      payments: [
        payment({ id: "p-1", kind: "payment", amount: 5000 }),
        payment({ id: "r-1", kind: "refund", amount: 1000 }),
      ],
    });

    await waitFor(() => {
      expect(screen.getByText("Оплат и возвратов: 2")).toBeDefined();
    });

    expect(overRefundMarker()).toBeNull();
  });

  it("фактов нет — пометки нет: ноль возвратов не «больше» нуля оплат", async () => {
    setup();

    await waitFor(() => {
      expect(screen.getByText("Оплат пока нет")).toBeDefined();
    });

    expect(overRefundMarker()).toBeNull();
  });

  it("сумма возвратов остаётся видна отдельной строкой сводки", async () => {
    // Требование ТЗ: возвраты показываются собственной строкой, а не только
    // уменьшением итога, — иначе уменьшение оплаты выглядит как правка истории.
    //
    // Проверяется по тексту карточки: подпись и сумма лежат в одном `span`, и у
    // него нет собственного текста «Возвраты».
    setup({
      payments: [
        payment({ id: "p-1", kind: "payment", amount: 3000 }),
        payment({ id: "r-1", kind: "refund", amount: 5000 }),
      ],
    });

    await waitFor(() => {
      expect(progressText()).toContain("Возвраты");
    });

    expect(progressText()).toContain(money(5000));
  });
});
