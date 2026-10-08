import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ServiceOperationModal } from "./service-operation-modal";
import type { ServiceOperation } from "@/actions/service-operations";
import type { ServiceOperationType } from "@/lib/constants";

/**
 * Форма читает из контекста билдера только позиции, операции и колбэки, поэтому
 * в тесте это минимальный объект. Тип берётся у самого пропа, а не импортом
 * `SpecBuilderContext`: тот модуль тянет server actions с сессией next-auth, и
 * тест падал бы на импорте, не дойдя до проверок.
 */
type ModalCtx = Parameters<typeof ServiceOperationModal>[0]["ctx"];

/**
 * Тип услуги приходит в форму предвыбранным и остаётся полем формы.
 *
 * Раньше «Доставка» и «Монтаж» были отдельными входами в один и тот же диалог:
 * тип приходил пропом и в форме не менялся. Теперь тип приходит из команды
 * списка в карточке материала («Создать доставку», «Создать монтаж», «Создать
 * «…»») или из кнопки нижней панели, а в форме его можно сменить. Он определяет
 * подпись заголовка, наличие названия, доступные позиции и то, что уйдёт на
 * сервер; отметка «Исполнено» есть у всех типов.
 *
 * Проверяется именно это: без выбора типа в форме задача не решена, а сервер
 * получает не тот `type`.
 *
 * Server actions подменены модульным моком: реальный action требует сессии
 * next-auth и БД. Контекст билдера — минимальный: форма читает из него только
 * позиции, операции и три колбэка.
 */

const createMock = vi.hoisted(() => vi.fn());
const updateMock = vi.hoisted(() => vi.fn());
const deleteMock = vi.hoisted(() => vi.fn());

vi.mock("@/actions/service-operations", () => ({
  createServiceOperation: createMock,
  updateServiceOperation: updateMock,
  deleteServiceOperation: deleteMock,
}));

/**
 * Сессия тоже подменяется: через `lib/queries` (тип компании) форма
 * транзитивно доходит до `lib/auth/session`, а тот тянет next-auth с серверными
 * модулями Next — в Vitest их нет. Тесту нужен только тип, поэтому заглушки
 * достаточно.
 */
vi.mock("@/lib/auth/session", () => ({
  requireOrgBySlug: vi.fn(),
  getSession: vi.fn(),
  auth: vi.fn(),
}));

function operation(overrides: Partial<ServiceOperation> = {}): ServiceOperation {
  return {
    id: "op-1",
    type: "service",
    name: "Уборка",
    amount: 2000,
    completed: false,
    deadline: null,
    contractor_company_id: null,
    contractor_name: null,
    notes: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    spec_item_ids: [],
    ...overrides,
  };
}

/** Аргументы отрисовки формы: всё, что тесту нужно поменять. */
type SetupArgs = {
  type?: ServiceOperationType;
  operation?: ServiceOperation;
  initialName?: string | null;
  items?: Array<{ id: string; code: string; name: string }>;
  operations?: ServiceOperation[];
  preselectedItemIds?: string[];
};

function setup({
  type = "service",
  operation: op,
  initialName = null,
  items = [],
  operations = [],
  preselectedItemIds,
}: SetupArgs = {}) {
  const onOperationCreated = vi.fn();
  const onOperationUpdated = vi.fn();
  const onClose = vi.fn();

  const ctx = {
    orgSlug: "org",
    projectId: "project",
    items,
    selectedItems: [],
    operations,
    onOperationCreated,
    onOperationUpdated,
    onOperationDeleted: vi.fn(),
  } as unknown as ModalCtx;

  render(
    <ServiceOperationModal
      type={type}
      operation={op}
      initialName={initialName}
      preselectedItemIds={preselectedItemIds}
      ctx={ctx}
      companies={[]}
      onClose={onClose}
    />,
  );

  return { onOperationCreated, onOperationUpdated, onClose };
}

/**
 * Элемент формы: «Позиции» — контейнер с материалами операции.
 *
 * Поиск идёт по контейнеру диалога, а не по всему документу: поповеры
 * (тип услуги, подрядчик) рендерятся порталом рядом и содержат те же подписи.
 */
function dialog(): HTMLElement {
  return screen.getByRole("dialog");
}

const typeTrigger = () =>
  screen.getByRole("combobox", { name: "Тип услуги" });
const typeSearch = () =>
  screen.getByRole("combobox", { name: "Найти или создать тип…" });
/** Кнопка отправки формы: своя подпись у каждого типа услуги. */
const submitButton = () =>
  screen.getByRole("button", { name: /^(Добавить|Создать|Сохранить)/ });

async function pickType(
  user: ReturnType<typeof userEvent.setup>,
  label: string,
) {
  await user.click(typeTrigger());
  // Строка списка ищется внутри поповера: та же подпись есть в заголовке формы.
  const popup = screen.getByRole("listbox", { name: "Типы услуг" });
  await user.click(within(popup).getByText(label));
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/* ------------------------------------------------------------------ */
/*  Тип — поле формы                                                  */
/* ------------------------------------------------------------------ */

describe("ServiceOperationModal · тип услуги в форме", () => {
  it("тип выбирается в форме, а не при открытии", () => {
    setup({ type: "service" });

    expect(typeTrigger()).toBeTruthy();
    expect(typeTrigger().textContent).toContain("Своя услуга");
  });

  it("в списке типов есть «Доставка» и «Монтаж»", async () => {
    const user = userEvent.setup();
    setup({ type: "service" });
    await user.click(typeTrigger());

    expect(screen.getByText("Доставка")).toBeTruthy();
    expect(screen.getByText("Монтаж")).toBeTruthy();
  });

  it("выбор «Монтаж» переключает форму: название исчезает, заголовок меняется", async () => {
    const user = userEvent.setup();
    setup({ type: "service" });

    // У своей услуги название есть.
    expect(within(dialog()).getByText("Название услуги")).toBeTruthy();

    await pickType(user, "Монтаж");

    expect(typeTrigger().textContent).toContain("Монтаж");
    expect(within(dialog()).queryByText("Название услуги")).toBeNull();
    // Заголовок формы назван типом.
    expect(
      within(dialog()).getByRole("heading", { name: /^Монтаж/ }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Создать монтаж" }),
    ).toBeTruthy();
  });

  it("«Исполнено» есть у всех типов, а следствие отметки — только у доставки", async () => {
    const user = userEvent.setup();
    setup({ type: "service" });

    // Своя услуга: отметка закрывает работу, статусы материалов не меняются.
    expect(within(dialog()).getByText("Исполнено")).toBeTruthy();
    expect(
      within(dialog()).getByText(/срок перестаёт считаться просроченным/),
    ).toBeTruthy();

    await pickType(user, "Доставка");

    expect(within(dialog()).getByText("Исполнено")).toBeTruthy();
    expect(
      within(dialog()).getByText(/получат статус «Доставлено»/),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Создать доставку" }),
    ).toBeTruthy();
  });

  it("смена типа не сбрасывает отметку «Исполнено»", async () => {
    const user = userEvent.setup();
    setup({ type: "delivery" });

    const checkbox = screen.getByRole("checkbox", { name: "Исполнено" });
    await user.click(checkbox);
    expect(checkbox.getAttribute("aria-checked")).toBe("true");

    await pickType(user, "Монтаж");

    // Отметка относится к работе, а не к типу: закрыть её можно у любой
    // операции, и переключение типа не должно её терять.
    expect(
      screen.getByRole("checkbox", { name: "Исполнено" }).getAttribute("aria-checked"),
    ).toBe("true");
  });

  it("своя услуга создаётся вводом названия прямо в поле типа", async () => {
    const user = userEvent.setup();
    setup({ type: "delivery" });

    await user.click(typeTrigger());
    await user.type(typeSearch(), "Вывоз упаковки");
    await user.click(screen.getByText("Создать «Вывоз упаковки»"));

    expect(typeTrigger().textContent).toContain("Своя услуга");
    // Название из поля типа подставлено в поле названия.
    expect(screen.getByDisplayValue("Вывоз упаковки")).toBeTruthy();
  });

  it("название уже созданной своей услуги не предлагается создать заново", async () => {
    const user = userEvent.setup();
    setup({
      type: "service",
      operations: [operation({ id: "other", name: "Подъём на этаж" })],
    });

    await user.click(typeTrigger());
    await user.type(typeSearch(), "подъём на этаж");

    expect(screen.queryByText(/^Создать «/)).toBeNull();
    expect(screen.getByText("«подъём на этаж» уже есть в услугах")).toBeTruthy();
  });
});

/* ------------------------------------------------------------------ */
/*  Что уходит на сервер                                              */
/* ------------------------------------------------------------------ */

describe("ServiceOperationModal · тип в отправляемых данных", () => {
  it("создание: уходит тип, выбранный в форме", async () => {
    const user = userEvent.setup();
    createMock.mockResolvedValue({
      success: true,
      data: operation({ type: "installation", name: null }),
    });
    const { onOperationCreated } = setup({
      type: "service",
      // Монтаж оформляется на материалы: без позиции сервер (и форма) откажут.
      items: [{ id: "item-1", code: "КР-01", name: "Керамогранит" }],
      preselectedItemIds: ["item-1"],
    });

    await pickType(user, "Монтаж");
    await user.type(screen.getByPlaceholderText("0"), "8000");
    await user.click(submitButton());

    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
    expect(createMock.mock.calls[0][2]).toMatchObject({
      type: "installation",
      name: null,
      amount: 8000,
      specItemIds: ["item-1"],
    });
    expect(onOperationCreated).toHaveBeenCalledTimes(1);
  });

  it("создание своей услуги: уходит название, набранное в поле типа", async () => {
    const user = userEvent.setup();
    createMock.mockResolvedValue({
      success: true,
      data: operation({ name: "Вывоз упаковки" }),
    });
    setup({ type: "delivery" });

    await user.click(typeTrigger());
    await user.type(typeSearch(), "Вывоз упаковки");
    await user.click(screen.getByText("Создать «Вывоз упаковки»"));
    await user.type(screen.getByPlaceholderText("0"), "1500");
    await user.click(submitButton());

    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
    expect(createMock.mock.calls[0][2]).toMatchObject({
      type: "service",
      name: "Вывоз упаковки",
    });
  });

  it("редактирование: смена типа уходит в update, а не в create", async () => {
    const user = userEvent.setup();
    updateMock.mockResolvedValue({
      success: true,
      data: operation({ type: "delivery", name: null }),
    });
    const { onOperationUpdated } = setup({
      type: "service",
      operation: operation({ spec_item_ids: ["item-1"] }),
    });

    await pickType(user, "Доставка");
    await user.click(screen.getByRole("button", { name: "Сохранить" }));

    await waitFor(() => expect(updateMock).toHaveBeenCalledTimes(1));
    expect(updateMock.mock.calls[0][2]).toBe("op-1");
    expect(updateMock.mock.calls[0][3]).toMatchObject({
      type: "delivery",
      name: null,
      specItemIds: ["item-1"],
    });
    expect(createMock).not.toHaveBeenCalled();
    expect(onOperationUpdated).toHaveBeenCalledTimes(1);
  });

  it("ошибка сервера показывается и не закрывает форму", async () => {
    const user = userEvent.setup();
    createMock.mockResolvedValue({
      success: false,
      error: "Материал уже связан с другой доставкой",
    });
    const { onOperationCreated } = setup({
      type: "delivery",
      items: [{ id: "item-1", code: "КР-01", name: "Керамогранит" }],
      preselectedItemIds: ["item-1"],
    });

    await user.type(screen.getByPlaceholderText("0"), "5000");
    await user.click(submitButton());

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(
        "Материал уже связан с другой доставкой",
      ),
    );
    expect(onOperationCreated).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ */
/*  Название своей услуги                                            */
/* ------------------------------------------------------------------ */

describe("ServiceOperationModal · название своей услуги", () => {
  it("пустое название не отправляется и объясняется", async () => {
    const user = userEvent.setup();
    setup({ type: "service", initialName: "  " });

    await user.type(screen.getByPlaceholderText("0"), "1000");
    await user.click(submitButton());

    expect(screen.getByRole("alert").textContent).toContain(
      "Укажите название услуги",
    );
    expect(createMock).not.toHaveBeenCalled();
  });

  it("черновик названия из combobox карточки подставлен в форму", () => {
    setup({ type: "service", initialName: "Вывоз упаковки" });

    expect(screen.getByDisplayValue("Вывоз упаковки")).toBeTruthy();
  });
});
