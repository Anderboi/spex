import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import PaymentsTab from "./payments-tab";
import { documentChip, documentChipIn } from "./document-chips-test-helper";
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
const fileUrlsMock = vi.hoisted(() => vi.fn());

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

/** Документ позиции: `paymentId` проставляет сервер. */
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

/**
 * Выбор файла в скрытом input.
 *
 * `fireEvent.change` с подставленным `files`, а не `userEvent.upload`: проверка
 * размера должна достаться обработчику списка, а не отфильтроваться внутри
 * `userEvent`, который уважает ограничения input'а.
 */
function pickDocument(input: HTMLElement, chosen: File) {
  pickDocuments(input, [chosen]);
}

/** То же для пачки: `multiple` у input'а включён, файлы выбираются сразу. */
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

/**
 * Карточка одной записи: в ней живут чипсы её документов.
 *
 * Опорная точка — дата записи. Она встречается в строке дважды (подпись факта и
 * подпись документа), поэтому берётся ПЕРВОЕ совпадение: подпись факта стоит в
 * разметке выше. Так тест не зависит от того, какой именно элемент обрамляет
 * карточку, а дата не повторяется в других записях (суммы повторяются — в
 * карточке прогресса та же цифра).
 */
const paymentCard = (date: string) =>
  screen.getAllByText(date)[0].closest("div.rounded-xl") as HTMLElement;

describe("PaymentsTab · документы к оплате", () => {
  it("документ виден чипсом у своей оплаты и не виден у чужой", async () => {
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
      expect(documentChip("Чек №7.pdf")).toBeDefined();
    });

    // Документ привязан к первой записи: чипс один, и лежит он в карточке этой
    // оплаты — вторая карточка осталась с одним приглашением.
    expect(
      documentChipIn(paymentCard("1 октября 2026 г."), "Чек №7.pdf"),
    ).toBeDefined();
    expect(
      within(paymentCard("5 октября 2026 г.")).queryByRole("img"),
    ).toBeNull();
  });

  it("чипс показывает вид документа, а имя — в подсказке: управление во вкладке «Файлы»", async () => {
    setup({
      payments: [payment({ id: "p-1", paidAt: "2026-10-01" })],
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
    // Меню и кнопок у документа оплаты в строке больше нет: открыть, скачать,
    // переименовать, сменить вид и удалить можно только во вкладке «Файлы».
    expect(screen.queryByRole("button", { name: /^Открыть «/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Действия с «/ })).toBeNull();
  });

  it("больше трёх документов — одна строка и инертный счётчик «+N», без попапа", async () => {
    const user = userEvent.setup();

    setup({
      payments: [payment({ id: "p-1", paidAt: "2026-10-01" })],
      files: Array.from({ length: 5 }, (_, index) =>
        file({
          id: `f-${index}`,
          fileName: `Чек ${index}.pdf`,
          category: "receipt",
          paymentId: "p-1",
          payment: { kind: "payment", paidAt: "2026-10-01", cancelled: false },
        }),
      ),
    });

    await waitFor(() => {
      expect(screen.getByText("+2")).toBeDefined();
    });

    // Три чипса и «+2» вместо пяти: счётчик занимает одну строку, а не вторую.
    expect(documentChip("Чек 0.pdf")).toBeDefined();
    expect(documentChip("Чек 2.pdf")).toBeDefined();
    expect(screen.queryByLabelText("Чек: Чек 3.pdf")).toBeNull();
    await user.click(screen.getByText("+2"));
    // Счётчик инертен: попап требовал бы клика, которого у чипсов нет.
    expect(screen.queryByRole("menu")).toBeNull();
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
    expect(screen.queryByLabelText("Чертёж: Чертёж.dwg")).toBeNull();
  });

  it("документ к отменённой оплате не показывается ни у одной живой записи", async () => {
    // Отмена оплаты документ не удаляет: он остаётся во вкладке «Файлы» с
    // пометкой. Здесь ему места нет — проводки, к которой он приложен, в
    // списке фактов уже нет.
    setup({
      payments: [payment({ id: "p-1" })],
      files: [
        file({
          id: "f-old",
          fileName: "Чек к отменённой.pdf",
          paymentId: "p-cancelled",
          payment: { kind: "payment", paidAt: null, cancelled: true },
        }),
      ],
    });

    await waitFor(() => {
      expect(screen.getByText("Оплат и возвратов: 1")).toBeDefined();
    });

    expect(screen.queryByText("Чек к отменённой.pdf")).toBeNull();
  });

  it("документ прикрепляется к ЭТОЙ оплате: payment_id, доставшийся перетаскиванием", async () => {
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
      payments: [
        payment({ id: "payment-1", paidAt: "2026-10-01" }),
        payment({ id: "payment-2", paidAt: "2026-10-05" }),
      ],
    });

    await waitFor(() => {
      expect(screen.getByText("Оплат и возвратов: 2")).toBeDefined();
    });

    const card = paymentCard("1 октября 2026 г.");
    const zone = card.querySelector("[data-drag-active]") as HTMLElement;
    const dropped = new File(["чек"], "Поручение.pdf", { type: "application/pdf" });

    fireEvent.drop(zone, { dataTransfer: { files: [dropped], types: ["Files"] } });

    // Вид спрашивается сразу после приёма: до ответа файл на сервер не уходит.
    await waitFor(() => {
      expect(within(card).getByText("Поручение.pdf")).toBeDefined();
    });
    expect(uploadFileMock).not.toHaveBeenCalled();

    await userEvent.setup().click(within(card).getByRole("button", { name: "Чек" }));

    await waitFor(() => {
      expect(uploadFileMock).toHaveBeenCalledTimes(1);
    });

    const [orgSlug, itemId, formData] = uploadFileMock.mock.calls[0];
    expect(orgSlug).toBe("acme");
    expect(itemId).toBe("item-1");
    // Документ уходит к ЭТОЙ оплате, а не к позиции: вкладка «Файлы» пишет
    // `payment_id = ""`, и прикрепить чек к оплате можно только отсюда.
    expect((formData as FormData).get("payment_id")).toBe("payment-1");
    // Догадка сервера перебита явным видом: PDF он назвал бы «Документом», и
    // роль подтверждения потерялась бы молча (ADR 0005).
    expect((formData as FormData).get("category")).toBe("receipt");

    // Запись сервера встаёт в строку сразу — без второго запроса.
    await waitFor(() => {
      expect(documentChipIn(card, "Поручение.pdf")).toBeDefined();
    });
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

    setup({ payments: [payment({ id: "p-1", paidAt: "2026-10-01" })] });

    await waitFor(() => {
      expect(screen.getByText("Оплат и возвратов: 1")).toBeDefined();
    });

    const card = paymentCard("1 октября 2026 г.");
    pickDocuments(within(card).getByLabelText("Выбрать файлы для загрузки"), [
      new File(["счёт"], "Основание.pdf", { type: "application/pdf" }),
      new File(["чек"], "Подтверждение.pdf", { type: "application/pdf" }),
    ]);

    // Вид спрашивают у каждого файла отдельно: у основания и подтверждения
    // роли разные, и один ответ на пачку потерял бы одну из них.
    await user.click(within(card).getByRole("button", { name: "Счёт" }));
    await waitFor(() => expect(uploadFileMock).toHaveBeenCalledTimes(1));

    await waitFor(() => {
      expect(within(card).getByText("Подтверждение.pdf")).toBeDefined();
    });
    await user.click(within(card).getByRole("button", { name: "Чек" }));

    await waitFor(() => expect(uploadFileMock).toHaveBeenCalledTimes(2));
    expect((uploadFileMock.mock.calls[0][2] as FormData).get("category")).toBe("invoice");
    expect((uploadFileMock.mock.calls[1][2] as FormData).get("category")).toBe("receipt");

    // Оба документа в строке: ответы сервера, а не локальная догадка.
    await waitFor(() => {
      expect(documentChipIn(card, "Основание.pdf")).toBeDefined();
      expect(documentChipIn(card, "Подтверждение.pdf")).toBeDefined();
    });
  });

  it("ошибка загрузки снимается следующей удачной отправкой", async () => {
    const user = userEvent.setup();

    uploadFileMock
      .mockResolvedValueOnce({ success: false, error: "Тип файла не поддерживается" })
      .mockResolvedValueOnce({
        success: true,
        data: file({
          id: "f-ok",
          fileName: "Второй.pdf",
          category: "receipt",
          paymentId: "p-1",
          payment: { kind: "payment", paidAt: "2026-10-01", cancelled: false },
        }),
      });

    setup({ payments: [payment({ id: "p-1", paidAt: "2026-10-01" })] });

    await waitFor(() => {
      expect(screen.getByText("Оплат и возвратов: 1")).toBeDefined();
    });

    const card = paymentCard("1 октября 2026 г.");
    const picker = within(card).getByLabelText("Выбрать файлы для загрузки");

    pickDocument(picker, new File(["чек"], "Первый.pdf", { type: "application/pdf" }));
    await user.click(within(card).getByRole("button", { name: "Чек" }));

    await waitFor(() => {
      expect(screen.getByText("Тип файла не поддерживается")).toBeDefined();
    });

    // Поведение сохраняется: вторая удачная отправка гасит текст отказа, а не
    // оставляет его висеть над строкой.
    pickDocument(picker, new File(["чек"], "Второй.pdf", { type: "application/pdf" }));
    await user.click(within(card).getByRole("button", { name: "Чек" }));

    await waitFor(() => {
      expect(screen.queryByText("Тип файла не поддерживается")).toBeNull();
    });
    expect(documentChipIn(card, "Второй.pdf")).toBeDefined();
  });

  it("наблюдатель видит чипс, но не получает ни точки прикрепления, ни шага выбора вида", async () => {
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
      expect(documentChip("Чек №7.pdf")).toBeDefined();
    });

    // Чтение правами не описывается — документ виден; запись правами описана.
    expect(
      screen.queryByRole("button", { name: /^Прикрепить счёт или чек/ }),
    ).toBeNull();
    // И шага выбора вида наблюдатель тоже не получает: он ничего не прикрепляет.
    expect(screen.queryByRole("group", { name: "Какой это документ?" })).toBeNull();

    const dropped = new File(["чек"], "Чужой.pdf", { type: "application/pdf" });
    fireEvent.drop(
      paymentCard("1 октября 2026 г.").querySelector("[data-drag-active]") as HTMLElement,
      { dataTransfer: { files: [dropped], types: ["Files"] } },
    );

    expect(screen.queryByRole("group", { name: "Какой это документ?" })).toBeNull();
    expect(uploadFileMock).not.toHaveBeenCalled();
  });

  it("удаление и смена вида документа у оплаты недоступны: они живут во вкладке «Файлы»", async () => {
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
      expect(documentChip("Чек №7.pdf")).toBeDefined();
    });

    // Ни меню `⋯`, ни кнопки удаления: управление документом в одном месте —
    // во вкладке «Файлы», соседней вкладке той же модалки.
    expect(screen.queryByRole("button", { name: /^Действия с «/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Вид документа «/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Скачать «Чек №7.pdf»" })).toBeNull();
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
