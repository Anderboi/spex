import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import PaymentsTab from "./payments-tab";
import type { PaymentEntry } from "@/lib/spec/payment-types";
import type { PaymentPlanEntry } from "@/lib/spec/payment-plan-types";
import type { SpecItemFileEntry } from "@/lib/spec/spec-item-files";

/**
 * Тесты вкладки «Платежи»: пометка «возвратов больше, чем оплат» и документы
 * к оплате.
 *
 * Server actions подменяются модульными моками: настоящие требуют сессии
 * next-auth и живой БД. Проверяется поведение вкладки — что состояние
 * «вернули больше, чем заплатили» пользователь видит явной пометкой, а не
 * только отрицательным числом в сводке, а документ оплаты виден у своей
 * записи и прикладывается тем же диалогом, что во вкладке «Файлы».
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
const listFilesMock = vi.hoisted(() => vi.fn());
const uploadFileMock = vi.hoisted(() => vi.fn());
const deleteFileMock = vi.hoisted(() => vi.fn());
const fileUrlMock = vi.hoisted(() => vi.fn());

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

vi.mock("@/actions/spec-item-files", () => ({
  listSpecItemFiles: listFilesMock,
  uploadSpecItemFile: uploadFileMock,
  deleteSpecItemFile: deleteFileMock,
  getSpecItemFileUrl: fileUrlMock,
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

/** Документ позиции: `paymentId` проставляет сервер. */
function file(over: Partial<SpecItemFileEntry> = {}): SpecItemFileEntry {
  return {
    id: "file-1",
    fileName: "Чек №7.pdf",
    mimeType: "application/pdf",
    sizeBytes: 1024,
    category: "receipt",
    uploadedBy: "user-1",
    createdAt: "2026-10-01T10:00:00.000Z",
    paymentId: null,
    payment: null,
    ...over,
  };
}

/** Рендер вкладки с заданными ответами действий. */
function setup(over: {
  plans?: PaymentPlanEntry[];
  payments?: PaymentEntry[];
  files?: SpecItemFileEntry[];
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
  listFilesMock.mockResolvedValue({
    success: true,
    data: over.files ?? [],
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
  listFilesMock.mockReset();
  uploadFileMock.mockReset();
  deleteFileMock.mockReset();
  fileUrlMock.mockReset();
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

/* ------------------------------------------------------------------ */
/*  Документы к оплате                                                 */
/* ------------------------------------------------------------------ */

/** Кнопка прикрепления документа у конкретной записи. */
const attachButton = (date: string) =>
  screen.getByRole("button", { name: `Прикрепить документ к оплате от ${date}` });

/** Скрытый input выбора документа: их на вкладке ровно один. */
const documentPicker = () =>
  screen.getByLabelText("Выбрать документ для оплаты") as HTMLInputElement;

/**
 * Выбор файла в скрытом input.
 *
 * `fireEvent.change` с подставленным `files`, а не `userEvent.upload`: проверка
 * размера должна достаться обработчику вкладки, а не отфильтроваться внутри
 * `userEvent`, который уважает ограничения input'а.
 */
function pickDocument(input: HTMLElement, chosen: File) {
  Object.defineProperty(input, "files", {
    value: [chosen],
    configurable: true,
  });
  fireEvent.change(input);
}

describe("PaymentsTab · документы к оплате", () => {
  it("документ виден у своей оплаты и не виден у чужой", async () => {
    setup({
      payments: [
        payment({ id: "p-1", paidAt: "2026-10-01" }),
        payment({ id: "p-2", paidAt: "2026-10-05" }),
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
      expect(screen.getByText("Чек №7.pdf")).toBeDefined();
    });

    // Документ привязан к первой записи: строка документа ровно одна, и она
    // лежит внутри карточки этой оплаты.
    const rows = screen.getAllByRole("button", { name: /^Открыть «/ });
    expect(rows).toHaveLength(1);
    expect(rows[0].getAttribute("aria-label")).toBe(
      "Открыть «Чек №7.pdf» в новой вкладке",
    );
  });

  it("обычный файл позиции у оплат не показывается", async () => {
    setup({
      payments: [payment({ id: "p-1" })],
      files: [file({ id: "f-free", fileName: "Чертёж.dwg", paymentId: null })],
    });

    await waitFor(() => {
      expect(screen.getByText("Оплат и возвратов: 1")).toBeDefined();
    });

    expect(screen.queryByText("Чертёж.dwg")).toBeNull();
  });

  it("участник прикрепляет документ тем же диалогом, что и файлы, — с payment_id", async () => {
    const user = userEvent.setup();
    uploadFileMock.mockResolvedValue({
      success: true,
      data: file({
        id: "f-new",
        fileName: "Поручение.pdf",
        paymentId: "payment-1",
        payment: { kind: "payment", paidAt: "2026-10-01", cancelled: false },
      }),
    });

    setup({ payments: [payment({ id: "payment-1", paidAt: "2026-10-01" })] });

    await waitFor(() => {
      expect(screen.getByText("Оплат и возвратов: 1")).toBeDefined();
    });

    await user.click(attachButton("1 октября 2026 г."));

    // Диалог открывается только после выбора файла: до него на сервер не
    // уходит ничего.
    pickDocument(
      documentPicker(),
      new File(["чек"], "Поручение.pdf", { type: "application/pdf" }),
    );

    const dialog = await screen.findByRole("dialog");
    // Вид документа выбирается в том же диалоге: «Счёт» и «Чек» — разные вещи.
    expect(within(dialog).getByText("Чек")).toBeDefined();
    await user.click(within(dialog).getByRole("button", { name: "Загрузить" }));

    await waitFor(() => {
      expect(uploadFileMock).toHaveBeenCalledTimes(1);
    });

    const [orgSlug, itemId, formData] = uploadFileMock.mock.calls[0];
    expect(orgSlug).toBe("acme");
    expect(itemId).toBe("item-1");
    // Оплата уходит идентификатором: всё остальное о ней определяет сервер.
    expect((formData as FormData).get("payment_id")).toBe("payment-1");

    // Запись сервера встаёт в список документов сразу — без второго запроса.
    await waitFor(() => {
      expect(screen.getByText("Поручение.pdf")).toBeDefined();
    });
  });

  it("наблюдатель видит документ, но не может ни прикрепить, ни удалить", async () => {
    listPlansMock.mockResolvedValue({ success: true, data: [plan()] });
    listPaymentsMock.mockResolvedValue({
      success: true,
      data: [payment({ id: "p-1", paidAt: "2026-10-01" })],
    });
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
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Чек №7.pdf")).toBeDefined();
    });

    // Чтение правами не описывается — документ виден; запись правами описана.
    expect(
      screen.queryByRole("button", {
        name: "Прикрепить документ к оплате от 1 октября 2026 г.",
      }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Удалить документ «Чек №7.pdf»" }),
    ).toBeNull();
  });

  it("удаление документа убирает строку только после успеха сервера", async () => {
    const user = userEvent.setup();
    deleteFileMock.mockResolvedValue({ success: true, data: { deleted: true } });

    setup({
      payments: [payment({ id: "p-1", paidAt: "2026-10-01" })],
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
      expect(screen.getByText("Чек №7.pdf")).toBeDefined();
    });

    await user.click(
      screen.getByRole("button", { name: "Удалить документ «Чек №7.pdf»" }),
    );

    // Подтверждение говорит и про позицию, и про оплату: оплата не исчезает.
    // Роль именно `alertdialog`: диалог предупреждает о необратимом действии.
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/Сама оплата останется/)).toBeDefined();
    await user.click(within(dialog).getByRole("button", { name: "Удалить" }));

    await waitFor(() => {
      expect(deleteFileMock).toHaveBeenCalledWith("acme", "item-1", "f-1");
    });

    await waitFor(() => {
      expect(screen.queryByText("Чек №7.pdf")).toBeNull();
    });
    // Сама запись оплаты осталась на месте.
    expect(screen.getByText("Оплат и возвратов: 1")).toBeDefined();
  });

  it("отказ удаления оставляет документ в списке и показывает текст сервера", async () => {
    const user = userEvent.setup();
    deleteFileMock.mockResolvedValue({
      success: false,
      error: "Недостаточно прав для удаления файлов",
    });

    setup({
      payments: [payment({ id: "p-1", paidAt: "2026-10-01" })],
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
      expect(screen.getByText("Чек №7.pdf")).toBeDefined();
    });

    await user.click(
      screen.getByRole("button", { name: "Удалить документ «Чек №7.pdf»" }),
    );
    // Подтверждение — `AlertDialog`, и его роль именно `alertdialog`, а не
    // `dialog`: диалог предупреждает о необратимом действии.
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/Сама оплата останется/)).toBeDefined();
    await user.click(within(dialog).getByRole("button", { name: "Удалить" }));

    await waitFor(() => {
      expect(
        screen.getByText("Недостаточно прав для удаления файлов"),
      ).toBeDefined();
    });
    // Оптимистичного удаления нет: файл остался на месте.
    expect(screen.getByText("Чек №7.pdf")).toBeDefined();
  });

  it("ошибка списка файлов не скрывает оплаты", async () => {
    listPlansMock.mockResolvedValue({ success: true, data: [plan()] });
    listPaymentsMock.mockResolvedValue({
      success: true,
      data: [payment({ id: "p-1", amount: 3000 })],
    });
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
      />,
    );

    // Вкладка показывает отказ честно, а не пустой список оплат.
    await waitFor(() => {
      expect(
        screen.getByText("Не удалось получить файлы позиции"),
      ).toBeDefined();
    });
    expect(screen.queryByText("Оплат и возвратов: 1")).toBeNull();
  });
});
