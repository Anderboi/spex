import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import PaymentsTab from "./payments-tab";
import { documentChip, documentChipIn } from "./document-chips-test-helper";
import type { PaymentEntry } from "@/lib/spec/payment-types";
import type { PaymentPlanEntry } from "@/lib/spec/payment-plan-types";
import type { SpecItemFileEntry } from "@/lib/spec/spec-item-files";
import type { SpecStatus } from "@/lib/constants";

/**
 * Тесты вкладки «Платежи»: строки-обязательства, отметка «Оплачено», пометка об
 * отмене, арифметика от стоимости и документы.
 *
 * Server actions подменяются модульными моками: настоящие требуют сессии
 * next-auth и живой БД. Проверяется поведение вкладки:
 *
 *   * план и факт — ОДНА строка на экране (ADR 0006), а не две;
 *   * маркер состояния вместо чипса вида записи;
 *   * отмена возвращает строку в «Не оплачено» и оставляет пометку;
 *   * остаток и процент считаются только по фактам.
 *
 * ── Почему арифметика здесь не пересчитывается ─────────────────────────────
 *
 * Суммы считает `lib/spec/payment-schedule` и проверяет их своими тестами: тест,
 * повторяющий формулу, подтверждал бы сам себя. Здесь проверяется то, чего в
 * чистом модуле нет, — что признак `refundsExceedPayments` ДОХОДИТ до экрана, а
 * соединение строк доезжает до разметки.
 */

const listPlansMock = vi.hoisted(() => vi.fn());
const listPaymentsMock = vi.hoisted(() => vi.fn());
const listCancellationsMock = vi.hoisted(() => vi.fn());
const listFilesMock = vi.hoisted(() => vi.fn());
const uploadFileMock = vi.hoisted(() => vi.fn());
const deleteFileMock = vi.hoisted(() => vi.fn());
const fileUrlMock = vi.hoisted(() => vi.fn());
const fileUrlsMock = vi.hoisted(() => vi.fn());
const createPlanMock = vi.hoisted(() => vi.fn());
const updatePlanMock = vi.hoisted(() => vi.fn());
const createPaymentMock = vi.hoisted(() => vi.fn());
const deletePaymentMock = vi.hoisted(() => vi.fn());

vi.mock("@/actions/spec-item-payment-plans", () => ({
  listPaymentPlans: listPlansMock,
  createPaymentPlan: createPlanMock,
  updatePaymentPlan: updatePlanMock,
}));

vi.mock("@/actions/spec-item-payments", () => ({
  listPayments: listPaymentsMock,
  listPaymentCancellations: listCancellationsMock,
  createPayment: createPaymentMock,
  updatePayment: vi.fn(),
  deletePayment: deletePaymentMock,
}));

vi.mock("@/actions/spec-item-files", () => ({
  listSpecItemFiles: listFilesMock,
  uploadSpecItemFile: uploadFileMock,
  deleteSpecItemFile: deleteFileMock,
  getSpecItemFileUrl: fileUrlMock,
  getSpecItemFileUrls: fileUrlsMock,
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

/** Документ позиции: `paymentId` и `paymentPlanId` проставляет сервер. */
function file(over: Partial<SpecItemFileEntry> = {}): SpecItemFileEntry {
  return {
    id: "file-1",
    fileName: "Чек №7.pdf",
    mimeType: "application/pdf",
    sizeBytes: 1024,
    category: "receipt",
    uploadedBy: "user-1",
    uploadedByName: "Andy",
    createdAt: "2026-10-01T10:00:00.000Z",
    paymentId: null,
    payment: null,
    paymentPlanId: null,
    paymentPlan: null,
    ...over,
  };
}

/** Рендер вкладки с заданными ответами действий. */
function setup(over: {
  plans?: PaymentPlanEntry[];
  payments?: PaymentEntry[];
  /** Отменённые оплаты: по ним строка получает пометку. */
  cancelled?: PaymentEntry[];
  files?: SpecItemFileEntry[];
  /** Стоимость позиции — база прогресса. */
  itemCost?: number;
  /**
   * Статус позиции. По умолчанию «Согласовано»: это обычное состояние, в котором
   * деньги вносить можно, — остальные кейсы включают ворота оплаты явно.
   */
  status?: SpecStatus;
  isPlaceholder?: boolean;
  /** Догон статуса после оплаты: «сервер перевёл позицию в „Заказано“». */
  onStatusFromServer?: (status: SpecStatus) => void;
} = {}) {
  listPlansMock.mockResolvedValue({
    success: true,
    data: over.plans ?? [plan()],
  });
  listPaymentsMock.mockResolvedValue({
    success: true,
    data: over.payments ?? [],
  });
  listCancellationsMock.mockResolvedValue({
    success: true,
    data: over.cancelled ?? [],
  });
  listFilesMock.mockResolvedValue({
    success: true,
    data: over.files ?? [],
  });
  /*
    Загрузка по умолчанию отвечает отказом, а не `undefined`: тесты о документах
    подставляют свой ответ, а остальные (наблюдатель, порядок строк) файлов не
    отправляют — и без этого значения чтение ответа падало бы в консоль.
  */
  uploadFileMock.mockResolvedValue({ success: false, error: "Не удалось загрузить файл" });

  render(
    <PaymentsTab
      orgSlug="acme"
      specItemId="item-1"
      role="owner"
      currentUserId="user-1"
      itemCost={over.itemCost ?? 10000}
      status={over.status ?? "approved"}
      isPlaceholder={over.isPlaceholder ?? false}
      onStatusFromServer={over.onStatusFromServer}
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

/**
 * Строка списка по её состоянию.
 *
 * Опорная точка — атрибут состояния, а не класс и не текст: состояние строки это
 * данные («оплачено» или «запланировано»), а оформление (зелёная рамка, маркер)
 * — украшение поверх него и меняться может свободно.
 */
const rows = (state: "planned" | "paid") =>
  screen.queryAllByTestId("payment-row").filter(
    (node) => node.getAttribute("data-payment-row") === state,
  );

/** Текст строки с обычными пробелами. */
const rowText = (row: HTMLElement) =>
  (row.textContent ?? "").replace(/\s/g, " ");

/**
 * Выбор файлов в скрытом input.
 *
 * `fireEvent.change` с подставленным `files`, а не `userEvent.upload`: проверка
 * размера должна достаться обработчику списка, а не отфильтроваться внутри
 * `userEvent`, который уважает ограничения input'а.
 */
function pickDocuments(input: HTMLElement, chosen: File[]) {
  Object.defineProperty(input, "files", {
    value: chosen,
    configurable: true,
  });
  fireEvent.change(input);
}

beforeEach(() => {
  listPlansMock.mockReset();
  listPaymentsMock.mockReset();
  listCancellationsMock.mockReset();
  listFilesMock.mockReset();
  uploadFileMock.mockReset();
  deleteFileMock.mockReset();
  fileUrlMock.mockReset();
  createPlanMock.mockReset();
  updatePlanMock.mockReset();
  createPaymentMock.mockReset();
  deletePaymentMock.mockReset();
});

afterEach(cleanup);

/* ------------------------------------------------------------------ */
/*  Прогресс                                                           */
/* ------------------------------------------------------------------ */

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
        payment({ id: "r-1", kind: "refund", amount: 1000, paymentPlanId: null }),
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

  it("плановая сумма в остаток не входит: он считается только по фактам", async () => {
    // Решение Q24: отдельной величины «запланировано» в шапке нет. Иначе у
    // неоплаченной позиции «осталось» уменьшалось бы от одного плана.
    setup({ plans: [plan({ amount: 10000 })], payments: [], itemCost: 10000 });

    await waitFor(() => {
      expect(progressText()).toContain("Осталось");
    });

    expect(progressText()).toContain(money(10000));
    expect(progressText()).toContain(money(0));
  });
});

/* ------------------------------------------------------------------ */
/*  Возвратов больше, чем оплат                                        */
/* ------------------------------------------------------------------ */

describe("PaymentsTab · возвратов больше, чем оплат", () => {
  it("пометка показана, когда возвраты превышают оплаты", async () => {
    setup({
      payments: [
        payment({ id: "p-1", kind: "payment", amount: 3000 }),
        payment({ id: "r-1", kind: "refund", amount: 5000, paymentPlanId: null }),
      ],
    });

    // Загрузка асинхронная: ждём, пока вкладка получит факты.
    await waitFor(() => {
      expect(screen.getByText("Строк: 2")).toBeDefined();
    });

    expect(overRefundMarker()).not.toBeNull();
  });

  it("пометка объясняет, что это состояние, а не ошибка ввода", async () => {
    setup({
      payments: [
        payment({ id: "p-1", kind: "payment", amount: 1000 }),
        payment({ id: "r-1", kind: "refund", amount: 4000, paymentPlanId: null }),
      ],
    });

    await waitFor(() => {
      expect(screen.getByText("Строк: 2")).toBeDefined();
    });

    const marker = overRefundMarker();
    expect(marker).not.toBeNull();

    // Случай не запрещён (решение Q13): причина не требуется, запись уже
    // сохранена. Поэтому текст говорит, что это состояние, а не ошибка ввода,
    // — иначе пользователь искал бы, что он сделал не так.
    expect(
      within(marker as HTMLElement).getByText(/Запись сохранена/),
    ).toBeDefined();
  });

  it("равные возвраты и оплаты пометки не дают", async () => {
    setup({
      payments: [
        payment({ id: "p-1", kind: "payment", amount: 5000 }),
        payment({ id: "r-1", kind: "refund", amount: 5000, paymentPlanId: null }),
      ],
    });

    await waitFor(() => {
      expect(screen.getByText("Строк: 2")).toBeDefined();
    });

    expect(overRefundMarker()).toBeNull();
  });

  it("возвраты меньше оплат пометки не дают", async () => {
    setup({
      payments: [
        payment({ id: "p-1", kind: "payment", amount: 5000 }),
        payment({ id: "r-1", kind: "refund", amount: 1000, paymentPlanId: null }),
      ],
    });

    await waitFor(() => {
      expect(screen.getByText("Строк: 2")).toBeDefined();
    });

    expect(overRefundMarker()).toBeNull();
  });

  it("фактов нет — пометки нет: ноль возвратов не «больше» нуля оплат", async () => {
    setup({ plans: [] });

    await waitFor(() => {
      expect(screen.getByText("График платежей пуст")).toBeDefined();
    });

    expect(overRefundMarker()).toBeNull();
  });

  it("сумма возвратов остаётся видна отдельной строкой сводки", async () => {
    // Требование ТЗ: возвраты показываются собственной строкой, а не только
    // уменьшением итога, — иначе уменьшение оплаты выглядит как правка истории.
    setup({
      payments: [
        payment({ id: "p-1", kind: "payment", amount: 3000 }),
        payment({ id: "r-1", kind: "refund", amount: 5000, paymentPlanId: null }),
      ],
    });

    await waitFor(() => {
      expect(progressText()).toContain("Возвраты");
    });

    expect(progressText()).toContain(money(5000));
  });
});

/* ------------------------------------------------------------------ */
/*  Одна строка на экране, две в хранилище                              */
/* ------------------------------------------------------------------ */

describe("PaymentsTab · план и факт — одна строка", () => {
  it("неоплаченный плановый платёж показывается строкой «Запланирован»", async () => {
    setup({ plans: [plan({ dueDate: "2026-11-01" })], payments: [] });

    await waitFor(() => {
      expect(rows("planned")).toHaveLength(1);
    });

    const text = rowText(rows("planned")[0]);
    expect(text).toContain("Запланирован");
    expect(text).toContain("Аванс 50 %");
    expect(text).toContain(money(10000));
    expect(text).toContain("до 1 ноября 2026 г.");
  });

  it("отметка «Оплачено» не добавляет вторую строку, а меняет состояние", async () => {
    // Главное требование ADR 0006. Две строки означали бы, что один и тот же
    // платёж виден дважды, и остаток в шапке перестал бы сходиться со списком.
    setup({
      plans: [plan()],
      payments: [payment({ paymentPlanId: "plan-1", amount: 10000 })],
    });

    await waitFor(() => {
      expect(rows("paid")).toHaveLength(1);
    });

    expect(rows("planned")).toHaveLength(0);
    expect(screen.getByText("Строк: 1")).toBeDefined();
  });

  it("маркер «Оплачено» стоит вместо чипса вида записи: два носителя не показываются", async () => {
    setup({
      plans: [plan()],
      payments: [payment({ kind: "payment", paymentPlanId: "plan-1" })],
    });

    await waitFor(() => {
      expect(rows("paid")).toHaveLength(1);
    });

    const text = rowText(rows("paid")[0]);
    expect(text).toContain("Оплачено");
    // Прежний чипс вида записи заменён маркером: слова «Оплата» отдельным
    // носителем того же смысла в строке больше нет.
    expect(text).not.toContain("Оплата");
  });

  it("возврат показывается своей строкой с маркером «Возврат»", async () => {
    // Решение Q33: плановая таблица видов не знает, запланировать возврат
    // нельзя, поэтому у возврата нет строки плана — он вносится отдельным входом.
    setup({
      plans: [plan()],
      payments: [
        payment({
          id: "r-1",
          kind: "refund",
          amount: 2000,
          paymentPlanId: null,
          paidAt: "2026-10-09",
        }),
      ],
    });

    await waitFor(() => {
      expect(rows("paid")).toHaveLength(1);
    });

    const text = rowText(rows("paid")[0]);
    expect(text).toContain("Возврат");
    expect(text).toContain(money(2000));
    // Строка плана при этом осталась неоплаченной: возврат её не закрывает.
    expect(rows("planned")).toHaveLength(1);
  });

  it("оплата без плана — своя строка, а не «без плана · вне графика»", async () => {
    setup({
      plans: [],
      payments: [payment({ paymentPlanId: null, amount: 4000 })],
    });

    await waitFor(() => {
      expect(rows("paid")).toHaveLength(1);
    });

    const text = rowText(rows("paid")[0]);
    expect(text).toContain("Оплачено");
    expect(text).toContain(money(4000));
    expect(screen.getByText("Строк: 1")).toBeDefined();
  });

  it("оплата по УДАЛЁННОЙ строке графика не пропадает из списка", async () => {
    // Строку графика удалили мягко, а оплата осталась. Спрятать её значило бы
    // показать в шапке то, чего нет в списке.
    setup({
      plans: [],
      payments: [payment({ paymentPlanId: "plan-deleted", amount: 4000 })],
    });

    await waitFor(() => {
      expect(rows("paid")).toHaveLength(1);
    });

    expect(rowText(rows("paid")[0])).toContain(money(4000));
  });

  it("строки графика идут по своему порядку и раньше фактов вне графика", async () => {
    setup({
      plans: [
        plan({ id: "plan-b", position: 1, title: "Второй" }),
        plan({ id: "plan-a", position: 0, title: "Первый" }),
      ],
      payments: [payment({ id: "p-1", paymentPlanId: null })],
    });

    await waitFor(() => {
      expect(rows("planned")).toHaveLength(2);
    });

    const order = screen
      .getAllByTestId("payment-row")
      .map((row) => rowText(row));
    expect(order[0]).toContain("Первый");
    expect(order[1]).toContain("Второй");
    expect(order[2]).toContain("Оплачено");
  });
});

/* ------------------------------------------------------------------ */
/*  Отмена оплаты                                                      */
/* ------------------------------------------------------------------ */

describe("PaymentsTab · отмена возвращает строку в неоплаченное", () => {
  it("отмена снимает факт со строки и оставляет пометку с датой проводки", async () => {
    const user = userEvent.setup();
    const paid = payment({
      id: "payment-1",
      paymentPlanId: "plan-1",
      paidAt: "2026-10-05",
      amount: 10000,
    });
    deletePaymentMock.mockResolvedValue({ success: true, data: { deleted: true } });

    setup({ plans: [plan()], payments: [paid] });

    await waitFor(() => {
      expect(rows("paid")).toHaveLength(1);
    });

    await user.click(
      screen.getByRole("button", { name: "Отменить оплату от 5 октября 2026 г." }),
    );
    await user.click(screen.getByRole("button", { name: "Отменить оплату" }));

    await waitFor(() => {
      expect(rows("planned")).toHaveLength(1);
    });

    const text = rowText(rows("planned")[0]);
    // Обязательство снова открыто, но отмена не исчезает молча (решение Q29).
    expect(text).toContain("Запланирован");
    expect(text).toContain("Оплата от 5 октября 2026 г. отменена");
    // Документ при этом не теряется: связь осталась, и файл виден во вкладке.
    expect(deleteFileMock).not.toHaveBeenCalled();
  });

  it("подтверждение предупреждает, что строка вернётся в «Не оплачено»", async () => {
    const user = userEvent.setup();
    setup({
      plans: [plan({ title: "Аванс 50 %" })],
      payments: [payment({ paymentPlanId: "plan-1", paidAt: "2026-10-05" })],
    });

    await waitFor(() => {
      expect(rows("paid")).toHaveLength(1);
    });

    await user.click(
      screen.getByRole("button", { name: "Отменить оплату от 5 октября 2026 г." }),
    );

    expect(screen.getByText(/вернётся в «Не оплачено»/)).toBeDefined();
    expect(screen.getByText(/«Аванс 50 %»/)).toBeDefined();
  });

  it("отмена оплаты без плана строку графика не возвращает", async () => {
    const user = userEvent.setup();
    deletePaymentMock.mockResolvedValue({ success: true, data: { deleted: true } });

    setup({
      plans: [],
      payments: [payment({ id: "p-1", paymentPlanId: null })],
    });

    await waitFor(() => {
      expect(rows("paid")).toHaveLength(1);
    });

    await user.click(
      screen.getByRole("button", { name: "Отменить оплату от 1 октября 2026 г." }),
    );
    await user.click(screen.getByRole("button", { name: "Отменить оплату" }));

    await waitFor(() => {
      expect(rows("paid")).toHaveLength(0);
    });
    expect(rows("planned")).toHaveLength(0);
  });

  it("отказ отмены оставляет строку оплаченной и показывает текст", async () => {
    const user = userEvent.setup();
    deletePaymentMock.mockResolvedValue({
      success: false,
      error: "Не удалось отменить оплату",
    });

    setup({ plans: [plan()], payments: [payment({ paymentPlanId: "plan-1" })] });

    await waitFor(() => {
      expect(rows("paid")).toHaveLength(1);
    });

    await user.click(
      screen.getByRole("button", { name: "Отменить оплату от 1 октября 2026 г." }),
    );
    await user.click(screen.getByRole("button", { name: "Отменить оплату" }));

    await waitFor(() => {
      expect(screen.getByText("Не удалось отменить оплату")).toBeDefined();
    });
    expect(rows("paid")).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------ */
/*  Отметка «Оплачено» и входы в форму                                  */
/* ------------------------------------------------------------------ */

describe("PaymentsTab · отметка «Оплачено»", () => {
  it("отметка переносит сумму плана как есть и связывает факт со строкой", async () => {
    const user = userEvent.setup();
    createPaymentMock.mockResolvedValue({
      success: true,
      data: payment({ paymentPlanId: "plan-1", amount: 10000, paidAt: "2026-10-05" }),
    });

    setup({ plans: [plan({ amount: 10000, dueDate: "2026-10-05" })] });

    await waitFor(() => {
      expect(rows("planned")).toHaveLength(1);
    });

    await user.click(
      screen.getByRole("button", { name: "Отметить «Аванс 50 %» оплаченным" }),
    );

    // Дата по умолчанию — срок плана (ADR 0006).
    expect(
      (screen.getByLabelText("Дата оплаты") as HTMLInputElement).value,
    ).toBe("2026-10-05");

    await user.click(screen.getByRole("button", { name: "Отметить оплаченным" }));

    await waitFor(() => expect(createPaymentMock).toHaveBeenCalledTimes(1));

    const [, itemId, payload] = createPaymentMock.mock.calls[0] as [
      string,
      string,
      { amount: number; paymentPlanId: string | null; paidAt: string | null },
    ];
    expect(itemId).toBe("item-1");
    // Сумма перенесена как есть, а не пересчитана от стоимости позиции.
    expect(payload.amount).toBe(10000);
    expect(payload.paymentPlanId).toBe("plan-1");
    expect(payload.paidAt).toBe("2026-10-05");
  });

  it("у оплаченной строки правятся ОБЕ записи: план и факт — кнопки разные", async () => {
    // «Изменить» у факта правит сумму и дату проводки, а строка графика — его
    // название, срок и условие. Пока обе правки были одной кнопкой, после оплаты
    // обязательство становилось нечем исправить (запланировать заново — значит
    // потерять связь с оплатой).
    const user = userEvent.setup();
    setup({
      plans: [plan({ title: "Аванс 50 %" })],
      payments: [payment({ paymentPlanId: "plan-1", paidAt: "2026-10-05" })],
    });

    await waitFor(() => {
      expect(rows("paid")).toHaveLength(1);
    });

    await user.click(screen.getByRole("button", { name: "Изменить «Аванс 50 %»" }));

    // Открылась форма ПЛАНА: поля графика, а не дата оплаты.
    expect(screen.getByLabelText("Название")).toBeDefined();
    expect(screen.getByLabelText("Срок оплаты")).toBeDefined();
    expect(screen.queryByLabelText("Дата оплаты")).toBeNull();
  });

  it("после успеха строка становится оплаченной без второго запроса", async () => {
    const user = userEvent.setup();
    createPaymentMock.mockResolvedValue({
      success: true,
      data: payment({
        id: "p-new",
        paymentPlanId: "plan-1",
        amount: 10000,
        paidAt: "2026-10-05",
      }),
    });

    setup({ plans: [plan({ dueDate: "2026-10-05" })] });

    await waitFor(() => {
      expect(rows("planned")).toHaveLength(1);
    });

    await user.click(
      screen.getByRole("button", { name: "Отметить «Аванс 50 %» оплаченным" }),
    );
    await user.click(screen.getByRole("button", { name: "Отметить оплаченным" }));

    await waitFor(() => {
      expect(rows("paid")).toHaveLength(1);
    });
    expect(rows("planned")).toHaveLength(0);
  });

  it("чипс счёта к плану в форме получает дату оплаты сразу после отметки", async () => {
    // Счёт связан ТОЛЬКО с планом: второй ссылки у него нет, и дату факта он
    // берёт из подписи плана. Без этого файл показывался бы подписью ожидания,
    // которое уже сбылось, — до следующего чтения списка.
    const user = userEvent.setup();
    createPaymentMock.mockResolvedValue({
      success: true,
      data: payment({
        id: "p-new",
        paymentPlanId: "plan-1",
        amount: 10000,
        paidAt: "2026-10-05",
      }),
    });

    setup({
      plans: [plan({ dueDate: "2026-10-05" })],
      files: [
        file({
          id: "f-plan",
          fileName: "Счёт на аванс.pdf",
          category: "invoice",
          paymentPlanId: "plan-1",
          paymentPlan: {
            id: "plan-1",
            title: "Аванс 50 %",
            amount: 10000,
            dueDate: "2026-10-05",
            paidAt: null,
          },
        }),
      ],
    });

    await waitFor(() => {
      expect(rows("planned")).toHaveLength(1);
    });

    await user.click(
      screen.getByRole("button", { name: "Отметить «Аванс 50 %» оплаченным" }),
    );
    await user.click(screen.getByRole("button", { name: "Отметить оплаченным" }));

    await waitFor(() => {
      expect(rows("paid")).toHaveLength(1);
    });

    // Файл остался в строке — теперь уже оплаченной, — и остался один: связь
    // добавилась, а не заменилась (ADR 0006).
    expect(documentChipIn(rows("paid")[0], "Счёт на аванс.pdf")).toBeDefined();
  });

  it("вкладка даёт вход в заведение платежа и отдельный возврат", async () => {
    const user = userEvent.setup();
    setup({ plans: [], payments: [] });

    await waitFor(() => {
      expect(screen.getByText("График платежей пуст")).toBeDefined();
    });

    /*
      Входы в форму ищутся в своей группе: «Внести оплату» и «Внести возврат»
      есть и у кнопок наверху, и у кнопки отправки формы — без группы запрос был
      бы неоднозначным.
    */
    const actions = () => screen.getByTestId("payment-actions");

    /*
      ОДИН вход в заведение платежа: внутри выбор «Аванс» или «Оплата», и оба
      варианта кладут в график обязательство. Отдельной кнопки «Запланировать»
      нет — оплата отмечается кнопкой на самой карточке, а не вторым диалогом.
    */
    await user.click(within(actions()).getByRole("button", { name: "Внести оплату" }));

    const operation = screen.getByRole("group", { name: "Что за платёж" });
    expect(
      within(operation).getByRole("button", { name: "Оплата" }).getAttribute(
        "aria-pressed",
      ),
    ).toBe("true");
    // Карточка заводится обязательством: даты оплаты в форме нет.
    expect(screen.getByLabelText("Срок оплаты")).toBeDefined();
    expect(screen.queryByLabelText("Дата оплаты")).toBeNull();

    await user.click(within(operation).getByRole("button", { name: "Аванс" }));

    await waitFor(() => {
      expect((screen.getByLabelText("Название") as HTMLInputElement).value).toBe(
        "Аванс",
      );
    });

    await user.click(screen.getByRole("button", { name: "Отмена" }));

    await user.click(within(actions()).getByRole("button", { name: "Внести возврат" }));
    // Возврат — закреплённый вид той же формы, а не вторая форма (решение Q33).
    expect(screen.queryByRole("combobox", { name: "Вид записи" })).toBeNull();
    expect(screen.queryByRole("group", { name: "Что за платёж" })).toBeNull();
    expect(screen.getByRole("heading", { name: /возврат/i })).toBeDefined();
  });

  it("карточка заводится обязательством и оплачивается кнопкой на ней", async () => {
    // Главный поток: «Внести оплату» кладёт платёж в график, а факт появляется
    // отметкой на карточке. Один вход — одно состояние — один способ его сменить.
    const user = userEvent.setup();
    createPlanMock.mockResolvedValue({
      success: true,
      data: plan({ id: "plan-new", title: "Аванс", amount: 5000, dueDate: null }),
    });

    setup({ plans: [], payments: [] });

    await waitFor(() => {
      expect(screen.getByText("График платежей пуст")).toBeDefined();
    });

    await user.click(
      within(screen.getByTestId("payment-actions")).getByRole("button", {
        name: "Внести оплату",
      }),
    );
    await user.click(
      within(screen.getByRole("group", { name: "Что за платёж" })).getByRole(
        "button",
        { name: "Аванс" },
      ),
    );
    await user.type(screen.getByLabelText("Сумма, ₽"), "5000");
    await user.click(screen.getByRole("button", { name: "Добавить в график" }));

    await waitFor(() => expect(createPlanMock).toHaveBeenCalledTimes(1));

    const [, itemId, payload] = createPlanMock.mock.calls[0] as [
      string,
      string,
      { title: string; amount: number },
    ];
    expect(itemId).toBe("item-1");
    expect(payload).toMatchObject({ title: "Аванс", amount: 5000 });
    // Факта при этом не создаётся: деньги ещё не ушли.
    expect(createPaymentMock).not.toHaveBeenCalled();

    // Карточка встала в список неоплаченной, и отметка у неё на месте.
    await waitFor(() => {
      expect(rows("planned")).toHaveLength(1);
    });
    expect(rowText(rows("planned")[0])).toContain("Запланирован");
    expect(rowText(rows("planned")[0])).toContain("Аванс");
    expect(
      screen.getByRole("button", { name: "Отметить «Аванс» оплаченным" }),
    ).toBeDefined();
  });

  it("наблюдателю входов записи не показывают", async () => {
    listPlansMock.mockResolvedValue({ success: true, data: [plan()] });
    listPaymentsMock.mockResolvedValue({ success: true, data: [] });
    listCancellationsMock.mockResolvedValue({ success: true, data: [] });
    listFilesMock.mockResolvedValue({ success: true, data: [] });

    render(
      <PaymentsTab
        orgSlug="acme"
        specItemId="item-1"
        role="viewer"
        currentUserId="user-2"
        itemCost={10000}
        status="approved"
        isPlaceholder={false}
      />,
    );

    await waitFor(() => {
      expect(rows("planned")).toHaveLength(1);
    });

    expect(screen.queryByRole("button", { name: "Запланировать" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Внести возврат" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Отметить «/ })).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/*  Документы к оплате                                                 */
/* ------------------------------------------------------------------ */

describe("PaymentsTab · документы к оплате", () => {
  it("документ виден чипсом у своей оплаты и не виден у чужой", async () => {
    setup({
      plans: [],
      payments: [
        payment({ id: "p-1", paymentPlanId: null, paidAt: "2026-10-01" }),
        payment({ id: "p-2", paymentPlanId: null, paidAt: "2026-10-05" }),
      ],
      files: [
        file({
          id: "f-1",
          fileName: "Чек №7.pdf",
          paymentId: "p-1",
          payment: { kind: "payment", paidAt: "2026-10-01", cancelled: false },
        }),
      ],
    });

    await waitFor(() => {
      expect(documentChip("Чек №7.pdf")).toBeDefined();
    });

    const paidRows = rows("paid");
    // Документ привязан к первой записи: чипс один, и лежит он в её строке.
    expect(documentChipIn(paidRows[0], "Чек №7.pdf")).toBeDefined();
    expect(within(paidRows[1]).queryByRole("img")).toBeNull();
  });

  it("счёт у неоплаченного плана виден в его строке, а не у оплаты", async () => {
    // Один файл, две точки входа — не копия: счёт приложен к плану и до оплаты
    // показывается там, где стоит обязательство.
    setup({
      plans: [plan()],
      payments: [],
      files: [
        file({
          id: "f-plan",
          fileName: "Счёт на аванс.pdf",
          category: "invoice",
          paymentPlanId: "plan-1",
          paymentPlan: {
            id: "plan-1",
            title: "Аванс 50 %",
            amount: 10000,
            dueDate: null,
            paidAt: null,
          },
        }),
      ],
    });

    await waitFor(() => {
      expect(documentChip("Счёт на аванс.pdf")).toBeDefined();
    });

    expect(documentChipIn(rows("planned")[0], "Счёт на аванс.pdf")).toBeDefined();
  });

  it("счёт, приложенный ТОЛЬКО к плану, виден и после оплаты", async () => {
    /*
      Связь с оплатой сама не появляется: файл прикладывали к плану, а отметку
      поставили позже. Спрятать его значило бы убрать основание из строки, в
      которой деньги уже прошли, — и «один файл, две точки входа» сломалось бы
      ровно на том документе, ради которого правило и писали.
    */
    setup({
      plans: [plan()],
      payments: [payment({ paymentPlanId: "plan-1", amount: 10000 })],
      files: [
        file({
          id: "f-plan",
          fileName: "Счёт на аванс.pdf",
          category: "invoice",
          paymentPlanId: "plan-1",
          paymentPlan: {
            id: "plan-1",
            title: "Аванс 50 %",
            amount: 10000,
            dueDate: null,
            paidAt: "2026-10-01",
          },
        }),
      ],
    });

    await waitFor(() => {
      expect(rows("paid")).toHaveLength(1);
    });

    expect(documentChipIn(rows("paid")[0], "Счёт на аванс.pdf")).toBeDefined();
  });

  it("чипс показывает вид документа, а имя — в подсказке: управление во вкладке «Файлы»", async () => {
    setup({
      plans: [],
      payments: [payment({ id: "p-1", paymentPlanId: null, paidAt: "2026-10-01" })],
      files: [
        file({
          id: "f-1",
          fileName: "Чек №7.pdf",
          category: "receipt",
          paymentId: "p-1",
          payment: { kind: "payment", paidAt: "2026-10-01", cancelled: false },
        }),
      ],
    });

    await waitFor(() => {
      expect(documentChip("Чек №7.pdf")).toBeDefined();
    });

    const chip = documentChip("Чек №7.pdf");
    expect(chip.textContent).toContain("Чек");
    // Имя показано подсказкой: два чека на разные суммы различаются только им.
    expect(chip.getAttribute("title")).toBe("Чек: Чек №7.pdf");
    expect(screen.queryByRole("button", { name: /^Открыть «/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Действия с «/ })).toBeNull();
  });

  it("документ к оплате прикрепляется к ЭТОЙ оплате: payment_id перетаскиванием", async () => {
    uploadFileMock.mockResolvedValue({
      success: true,
      data: file({
        id: "f-new",
        fileName: "Поручение.pdf",
        category: "receipt",
        paymentId: "payment-1",
        payment: { kind: "payment", paidAt: "2026-10-01", cancelled: false },
      }),
    });

    setup({
      plans: [],
      payments: [payment({ id: "payment-1", paymentPlanId: null, paidAt: "2026-10-01" })],
    });

    await waitFor(() => {
      expect(rows("paid")).toHaveLength(1);
    });

    const row = rows("paid")[0];
    const zone = row.querySelector("[data-drag-active]") as HTMLElement;
    const dropped = new File(["чек"], "Поручение.pdf", { type: "application/pdf" });

    fireEvent.drop(zone, { dataTransfer: { files: [dropped], types: ["Files"] } });

    // Вид спрашивается сразу после приёма: до ответа файл на сервер не уходит.
    await waitFor(() => {
      expect(within(row).getByText("Поручение.pdf")).toBeDefined();
    });
    expect(uploadFileMock).not.toHaveBeenCalled();

    await userEvent.setup().click(within(row).getByRole("button", { name: "Чек" }));

    await waitFor(() => {
      expect(uploadFileMock).toHaveBeenCalledTimes(1);
    });

    const [orgSlug, itemId, formData] = uploadFileMock.mock.calls[0] as [
      string,
      string,
      FormData,
    ];
    expect(orgSlug).toBe("acme");
    expect(itemId).toBe("item-1");
    expect(formData.get("payment_id")).toBe("payment-1");
    expect(formData.get("category")).toBe("receipt");
    // Вторая ссылка пуста: документ приложен к факту, а не к плану.
    expect(formData.get("payment_plan_id")).toBe("");
  });

  it("счёт к неоплаченному плану уходит с payment_plan_id, а не с payment_id", async () => {
    uploadFileMock.mockResolvedValue({
      success: true,
      data: file({
        id: "f-plan",
        fileName: "Счёт.pdf",
        category: "invoice",
        paymentPlanId: "plan-1",
        paymentPlan: {
          id: "plan-1",
          title: "Аванс 50 %",
          amount: 10000,
          dueDate: null,
          paidAt: null,
        },
      }),
    });

    setup({ plans: [plan()], payments: [] });

    await waitFor(() => {
      expect(rows("planned")).toHaveLength(1);
    });

    const row = rows("planned")[0];
    const zone = row.querySelector("[data-drag-active]") as HTMLElement;
    fireEvent.drop(zone, {
      dataTransfer: {
        files: [new File(["счёт"], "Счёт.pdf", { type: "application/pdf" })],
        types: ["Files"],
      },
    });

    await waitFor(() => {
      expect(within(row).getByText("Счёт.pdf")).toBeDefined();
    });

    await userEvent.setup().click(within(row).getByRole("button", { name: "Счёт" }));

    await waitFor(() => {
      expect(uploadFileMock).toHaveBeenCalledTimes(1);
    });

    const formData = uploadFileMock.mock.calls[0][2] as FormData;
    expect(formData.get("payment_plan_id")).toBe("plan-1");
    expect(formData.get("payment_id")).toBe("");
  });

  it("пачка принимается целиком: у каждого файла свой вид", async () => {
    const user = userEvent.setup();

    uploadFileMock
      .mockResolvedValueOnce({
        success: true,
        data: file({
          id: "f-1",
          fileName: "Основание.pdf",
          category: "invoice",
          paymentId: "p-1",
          payment: { kind: "payment", paidAt: "2026-10-01", cancelled: false },
        }),
      })
      .mockResolvedValueOnce({
        success: true,
        data: file({
          id: "f-2",
          fileName: "Подтверждение.pdf",
          category: "receipt",
          paymentId: "p-1",
          payment: { kind: "payment", paidAt: "2026-10-01", cancelled: false },
        }),
      });

    setup({
      plans: [],
      payments: [payment({ id: "p-1", paymentPlanId: null, paidAt: "2026-10-01" })],
    });

    await waitFor(() => {
      expect(rows("paid")).toHaveLength(1);
    });

    const row = rows("paid")[0];
    pickDocuments(within(row).getByLabelText("Выбрать файлы для загрузки"), [
      new File(["счёт"], "Основание.pdf", { type: "application/pdf" }),
      new File(["чек"], "Подтверждение.pdf", { type: "application/pdf" }),
    ]);

    // Вид спрашивают у каждого файла отдельно: у основания и подтверждения роли
    // разные, и один ответ на пачку потерял бы одну из них.
    await user.click(within(row).getByRole("button", { name: "Счёт" }));
    await waitFor(() => expect(uploadFileMock).toHaveBeenCalledTimes(1));

    await waitFor(() => {
      expect(within(row).getByText("Подтверждение.pdf")).toBeDefined();
    });
    await user.click(within(row).getByRole("button", { name: "Чек" }));

    await waitFor(() => expect(uploadFileMock).toHaveBeenCalledTimes(2));
    expect((uploadFileMock.mock.calls[0][2] as FormData).get("category")).toBe("invoice");
    expect((uploadFileMock.mock.calls[1][2] as FormData).get("category")).toBe("receipt");

    await waitFor(() => {
      expect(documentChipIn(row, "Основание.pdf")).toBeDefined();
      expect(documentChipIn(row, "Подтверждение.pdf")).toBeDefined();
    });
  });

  it("наблюдатель видит чипс, но не получает точки прикрепления", async () => {
    listPlansMock.mockResolvedValue({ success: true, data: [] });
    listPaymentsMock.mockResolvedValue({
      success: true,
      data: [payment({ id: "p-1", paymentPlanId: null, paidAt: "2026-10-01" })],
    });
    listCancellationsMock.mockResolvedValue({ success: true, data: [] });
    listFilesMock.mockResolvedValue({
      success: true,
      data: [
        file({
          id: "f-1",
          fileName: "Чек №7.pdf",
          paymentId: "p-1",
          payment: { kind: "payment", paidAt: "2026-10-01", cancelled: false },
        }),
      ],
    });

    render(
      <PaymentsTab
        orgSlug="acme"
        specItemId="item-1"
        role="viewer"
        currentUserId="user-2"
        itemCost={10000}
        status="approved"
        isPlaceholder={false}
      />,
    );

    await waitFor(() => {
      expect(documentChip("Чек №7.pdf")).toBeDefined();
    });

    // Чтение правами не описывается — документ виден; запись правами описана.
    expect(
      screen.queryByRole("button", { name: /^Прикрепить счёт или чек/ }),
    ).toBeNull();
    expect(screen.queryByRole("group", { name: "Какой это документ?" })).toBeNull();
  });

  it("ошибка списка файлов не скрывает оплаты", async () => {
    listPlansMock.mockResolvedValue({ success: true, data: [] });
    listPaymentsMock.mockResolvedValue({
      success: true,
      data: [payment({ id: "p-1", paymentPlanId: null, amount: 3000 })],
    });
    listCancellationsMock.mockResolvedValue({ success: true, data: [] });
    listFilesMock.mockResolvedValue({
      success: false,
      error: "Не удалось получить файлы позиции",
    });

    render(
      <PaymentsTab
        orgSlug="acme"
        specItemId="item-1"
        role="owner"
        currentUserId="user-1"
        itemCost={10000}
        status="approved"
        isPlaceholder={false}
      />,
    );

    // Вкладка показывает отказ честно, а не пустой список оплат.
    await waitFor(() => {
      expect(screen.getByText("Не удалось получить файлы позиции")).toBeDefined();
    });
    expect(rows("paid")).toHaveLength(0);
    expect(rows("planned")).toHaveLength(0);
  });

  it("отказ чтения отменённых не ломает список", async () => {
    // Пометка — справка, а не данные: без неё строки обязаны остаться.
    listPlansMock.mockResolvedValue({ success: true, data: [plan()] });
    listPaymentsMock.mockResolvedValue({ success: true, data: [] });
    listCancellationsMock.mockResolvedValue({
      success: false,
      error: "Не удалось получить отменённые оплаты",
    });
    listFilesMock.mockResolvedValue({ success: true, data: [] });

    render(
      <PaymentsTab
        orgSlug="acme"
        specItemId="item-1"
        role="owner"
        currentUserId="user-1"
        itemCost={10000}
        status="approved"
        isPlaceholder={false}
      />,
    );

    await waitFor(() => {
      expect(rows("planned")).toHaveLength(1);
    });
    expect(screen.queryByText("Не удалось получить отменённые оплаты")).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/*  ворота оплаты                                                      */
/* ------------------------------------------------------------------ */

/**
 * Деньги вносятся по позиции, которая уже в закупке, и заказывают её (ADR 0007).
 *
 * Здесь проверяется ГЕЙТ интерфейса и догон статуса; сам запрет живёт в ядре
 * (`lib/spec/payment-mutations`) и проверяется там. Скрытая кнопка — не защита, а
 * обещание пользователю: сервер отказал бы и без неё.
 */
describe("PaymentsTab · ворота оплаты", () => {
  it("до согласования отметки «Оплачено» нет, а причина названа", async () => {
    setup({ status: "picked" });

    await waitFor(() => {
      expect(rows("planned")).toHaveLength(1);
    });

    expect(screen.queryByRole("button", { name: /^Отметить «/ })).toBeNull();
    // Причина называется словами: спрятанная кнопка без объяснения читалась бы
    // как «здесь так и задумано», а дело не в правах и не в форме.
    expect(
      screen.getByText(/Оплата доступна по позициям в закупке/),
    ).toBeDefined();
  });

  it("у согласованной позиции отметка «Оплачено» на месте", async () => {
    setup({ status: "approved" });

    await waitFor(() => {
      expect(rows("planned")).toHaveLength(1);
    });

    expect(
      screen.getByRole("button", { name: "Отметить «Аванс 50 %» оплаченным" }),
    ).toBeDefined();
    expect(
      screen.queryByText(/Оплата доступна по позициям в закупке/),
    ).toBeNull();
  });

  it("заглушке отметка недоступна: у неё не бывает воронки", async () => {
    setup({ isPlaceholder: true, status: "picked" });

    await waitFor(() => {
      expect(rows("planned")).toHaveLength(1);
    });

    expect(screen.queryByRole("button", { name: /^Отметить «/ })).toBeNull();
  });

  it("возврат и счёт в график доступны и до согласования", async () => {
    // Ворота стоят на ДЕНЬГАХ: возврат исправляет уже записанное, а строка
    // графика — счёт, а не оплата. Запереть их значило бы запретить и
    // исправление ошибочной оплаты, и приём счетов до согласования.
    setup({ status: "picked" });

    await waitFor(() => {
      expect(rows("planned")).toHaveLength(1);
    });

    const actions = within(screen.getByTestId("payment-actions"));
    expect(actions.getByRole("button", { name: "Внести возврат" })).toBeDefined();
    expect(actions.getByRole("button", { name: "Внести оплату" })).toBeDefined();
  });

  it("успешная отметка сообщает наверх «Заказано»", async () => {
    // Сервер перевёл согласованную позицию в «Заказано»: список и воронка обязаны
    // узнать об этом, не дожидаясь перезагрузки, — иначе «Сумма в закупке» и
    // ворота считались бы по прежнему статусу.
    const user = userEvent.setup();
    const onStatusFromServer = vi.fn();
    createPaymentMock.mockResolvedValue({
      success: true,
      data: payment({ id: "p-new", paymentPlanId: "plan-1", amount: 10000 }),
    });

    setup({ status: "approved", onStatusFromServer });

    await waitFor(() => {
      expect(rows("planned")).toHaveLength(1);
    });

    await user.click(
      screen.getByRole("button", { name: "Отметить «Аванс 50 %» оплаченным" }),
    );
    await user.click(screen.getByRole("button", { name: "Отметить оплаченным" }));

    await waitFor(() => {
      expect(onStatusFromServer).toHaveBeenCalledWith("ordered");
    });
  });

  it("возврат статус наверх не отправляет", async () => {
    // Возврат деньги исправляет, а позицию не заказывает: догон был бы выдумкой
    // клиента о том, чего сервер не делал.
    const user = userEvent.setup();
    const onStatusFromServer = vi.fn();
    createPaymentMock.mockResolvedValue({
      success: true,
      data: payment({ id: "r-new", kind: "refund", paymentPlanId: null }),
    });

    setup({ status: "approved", onStatusFromServer });

    await waitFor(() => {
      expect(rows("planned")).toHaveLength(1);
    });

    await user.click(
      within(screen.getByTestId("payment-actions")).getByRole("button", {
        name: "Внести возврат",
      }),
    );
    await user.type(screen.getByLabelText("Сумма, ₽"), "1000");
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Внести возврат",
      }),
    );

    await waitFor(() => expect(createPaymentMock).toHaveBeenCalledTimes(1));
    expect(onStatusFromServer).not.toHaveBeenCalled();
  });
});
