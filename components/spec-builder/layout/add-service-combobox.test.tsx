import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi, type Mock } from "vitest";

import { AddServiceCombobox, ServiceTypeCombobox } from "./add-service-combobox";
import type { ServiceOperation } from "@/actions/service-operations";
import type { ServiceOperationType } from "@/lib/constants";
import type { ServiceTargetItem } from "@/lib/spec/service-catalog";

/**
 * Createable Combobox «Добавить услугу»: выбор существующей услуги проекта,
 * создание новой и кнопки быстрого добавления «Доставки» и «Монтажа».
 *
 * ── Что именно проверяется ────────────────────────────────────────────────
 *
 * Поведение, а не разметка: список услуг, поиск внутри combobox, отсутствие
 * предложения создать дубликат, отключение уже связанной услуги, что видно в
 * строке про позиции операции, состояния загрузки/ошибки, защита от повторного
 * выбора и то, что кнопка быстрого добавления заводит СВОЮ услугу, а не
 * подхватывает чужую. Структура списка и правила сравнения названий живут в
 * `lib/spec/service-catalog.ts` и проверяются там же — здесь они только
 * используются.
 *
 * `onAddExistingService` и `onQuickAddFixed` подменяются моками: реальные вызовы
 * идут в server actions, которым нужны сессия next-auth и БД.
 */

function op(overrides: Partial<ServiceOperation> = {}): ServiceOperation {
  return {
    id: "op-service",
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
    spec_item_ids: ["item-1"],
    ...overrides,
  };
}

const delivery = op({
  id: "op-delivery",
  type: "delivery",
  name: null,
  amount: 12_000,
  spec_item_ids: [],
});
const installation = op({
  id: "op-installation",
  type: "installation",
  name: null,
  amount: 8000,
  spec_item_ids: ["item-9"],
});
const own = op({ id: "op-own", type: "service", name: "Подъём на этаж" });
/** Вторая своя услуга — для проверки, что она фигурирует как существующая. */
const ownCleanup = op({
  id: "op-cleanup",
  type: "service",
  name: "Уборка",
  amount: 2000,
  spec_item_ids: [],
});

const ITEM_ID = "item-1";

/** Позиция карточки: к ней привязываются услуги. */
const TARGET: ServiceTargetItem = {
  id: ITEM_ID,
  code: "КР-01",
  name: "Керамогранит",
  status: "picked",
  isPlaceholder: false,
};

/**
 * Позиции проекта: по ним в строке списка видно, какие материалы уже в услуге.
 * `item-9` тоже здесь — на нём стоит монтаж по умолчанию.
 */
const ITEMS = [
  { id: ITEM_ID, code: "КР-01", name: "Керамогранит" },
  { id: "item-2", code: "МД-02", name: "Дуб натуральный" },
  { id: "item-9", code: "ПЛ-09", name: "Плитка" },
];

type Handlers = {
  onAddExistingService: Mock<(op: ServiceOperation) => Promise<boolean>>;
  onCreateService: Mock<(type: ServiceOperationType, name: string | null) => void>;
};

/** Обработчики + `rerender`: им проверяется обновление списка родителем. */
type Setup = Handlers & { rerender: (ui: React.ReactElement) => void };

function setup({
  catalog = [delivery, installation, own, ownCleanup],
  addResult = true,
  item = TARGET,
  ...rest
}: {
  catalog?: ServiceOperation[];
  addResult?: boolean;
  item?: ServiceTargetItem;
  catalogError?: string | null;
  loading?: boolean;
  onRetryCatalog?: () => void;
  disabled?: boolean;
} = {}): Setup {
  const handlers: Handlers = {
    onAddExistingService: vi.fn(async () => addResult),
    onCreateService: vi.fn(),
  };

  const view = render(
    <AddServiceCombobox
      item={item}
      items={ITEMS}
      catalog={catalog}
      onAddExistingService={handlers.onAddExistingService}
      onCreateService={handlers.onCreateService}
      {...rest}
    />,
  );

  return { ...handlers, rerender: view.rerender };
}

const trigger = () => screen.getByRole("combobox", { name: "Добавить услугу" });
const search = () =>
  screen.getByRole("combobox", { name: "Найти или создать услугу" });

/**
 * Строка внутри списка. Подписи «Доставка» и «Монтаж» есть и у кнопок быстрого
 * добавления, поэтому строки ищутся строго в listbox'е.
 */
const list = () => screen.getByRole("listbox", { name: "Услуги проекта" });
const row = (label: string) => within(list()).getByText(label);

/**
 * Кнопка быстрого добавления. Роль `button` с этой подписью одна: строки списка
 * — `option`, а триггер списка — `combobox`.
 */
const quickButton = (label: string) =>
  screen.getByRole("button", { name: label });

async function openCombobox(user: ReturnType<typeof userEvent.setup>) {
  await user.click(trigger());
  return search();
}

async function type(user: ReturnType<typeof userEvent.setup>, text: string) {
  await user.clear(search());
  await user.type(search(), text);
}

afterEach(cleanup);

/* ------------------------------------------------------------------ */
/*  Выбор существующей услуги                                         */
/* ------------------------------------------------------------------ */

describe("AddServiceCombobox · существующие услуги", () => {
  it("по «Добавить услугу» открывается combobox с существующими услугами", async () => {
    const user = userEvent.setup();
    setup();

    // До открытия списка его нет; кнопки быстрого добавления при этом на месте —
    // они и есть быстрый путь, ради которого список не открывают.
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(quickButton("Доставка")).toBeTruthy();

    await openCombobox(user);

    expect(row("Доставка")).toBeTruthy();
    expect(row("Монтаж")).toBeTruthy();
    expect(row("Подъём на этаж")).toBeTruthy();
  });

  it("порядок списка: существующие услуги, затем команды создания", async () => {
    const user = userEvent.setup();
    setup();
    await openCombobox(user);

    // У материала карточки нет ни доставки, ни монтажа, поэтому обе команды
    // создания на месте и идут после списка услуг.
    const items = screen.getAllByRole("option");
    expect(items.map((el) => el.textContent)).toEqual([
      expect.stringContaining("Доставка"),
      expect.stringContaining("Монтаж"),
      expect.stringContaining("Подъём на этаж"),
      expect.stringContaining("Уборка"),
      expect.stringContaining("Создать доставку"),
      expect.stringContaining("Создать монтаж"),
    ]);
  });

  it("поиск по названию оставляет только совпадения", async () => {
    const user = userEvent.setup();
    setup();
    await openCombobox(user);

    await type(user, "мон");

    expect(row("Монтаж")).toBeTruthy();
    expect(within(list()).queryByText("Доставка")).toBeNull();
    expect(within(list()).queryByText("Подъём на этаж")).toBeNull();
  });

  it("выбор «Доставка» привязывает материал к существующей услуге", async () => {
    const user = userEvent.setup();
    const h = setup();
    await openCombobox(user);

    await user.click(row("Доставка"));

    await waitFor(() => expect(h.onAddExistingService).toHaveBeenCalledTimes(1));
    expect(h.onAddExistingService).toHaveBeenCalledWith(delivery);
    // Услуга уже была — новая не создаётся.
    expect(h.onCreateService).not.toHaveBeenCalled();
  });

  it("выбор «Монтаж» привязывает материал к монтажу", async () => {
    const user = userEvent.setup();
    const h = setup();
    await openCombobox(user);

    await user.click(row("Монтаж"));

    await waitFor(() =>
      expect(h.onAddExistingService).toHaveBeenCalledWith(installation),
    );
    expect(h.onCreateService).not.toHaveBeenCalled();
  });

  it("услуга, уже добавленная к материалу, не выбирается повторно", async () => {
    const user = userEvent.setup();
    // «Подъём на этаж» связан с item-1 — это и есть материал карточки.
    const h = setup();
    await openCombobox(user);

    const linkedRow = row("Подъём на этаж").closest("[cmdk-item]");
    expect(linkedRow?.getAttribute("aria-disabled")).toBe("true");
    // Видимая пометка вместо прежней sr-only: видно, что услуга уже в этом
    // материале, а не просто «серая строка».
    expect(screen.getByText(/уже в этом материале/)).toBeTruthy();

    await user.click(row("Подъём на этаж"));
    expect(h.onAddExistingService).not.toHaveBeenCalled();
  });

  it("успешная привязка закрывает combobox", async () => {
    const user = userEvent.setup();
    setup();
    await openCombobox(user);

    await user.click(row("Доставка"));

    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
  });

  it("повторная привязка уже связанной услуги не создаёт дубликат", async () => {
    const user = userEvent.setup();
    const h = setup();
    await openCombobox(user);

    await user.click(row("Доставка"));
    await waitFor(() => expect(h.onAddExistingService).toHaveBeenCalledTimes(1));

    // Родитель обновил каталог ответом действия: материал уже в доставке.
    const updated = { ...delivery, spec_item_ids: [ITEM_ID] };
    h.rerender(
      <AddServiceCombobox
        item={TARGET}
        items={ITEMS}
        catalog={[updated, installation, own, ownCleanup]}
        onAddExistingService={h.onAddExistingService}
        onCreateService={h.onCreateService}
      />,
    );

    await openCombobox(user);
    const linkedRow = row("Доставка").closest("[cmdk-item]");
    expect(linkedRow?.getAttribute("aria-disabled")).toBe("true");

    await user.click(row("Доставка"));
    expect(h.onAddExistingService).toHaveBeenCalledTimes(1);
  });
});

/* ------------------------------------------------------------------ */
/*  Быстрое добавление «Доставки» и «Монтажа»                         */
/* ------------------------------------------------------------------ */

describe("AddServiceCombobox · кнопки быстрого добавления", () => {
  it("кнопка открывает форму создания услуги этого типа", async () => {
    const user = userEvent.setup();
    const h = setup({ catalog: [own, ownCleanup] });

    await user.click(quickButton("Доставка"));

    // Операция появится по сохранению формы: заранее ничего не создаётся.
    expect(h.onCreateService).toHaveBeenCalledWith("delivery", null);
    expect(h.onAddExistingService).not.toHaveBeenCalled();
  });

  it("существующая доставка НЕ подхватывается: у материала своя", async () => {
    const user = userEvent.setup();
    const h = setup();

    await user.click(quickButton("Доставка"));

    // Главное: материал не присоединяется молча к чужой доставке — иначе
    // введённая им стоимость ушла бы в общую операцию.
    expect(h.onCreateService).toHaveBeenCalledWith("delivery", null);
    expect(h.onAddExistingService).not.toHaveBeenCalled();
    // И список для этого не открывался.
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("несколько доставок в проекте — всё равно своя, без выбора из чужих", async () => {
    const user = userEvent.setup();
    const second = op({
      id: "op-delivery-2",
      type: "delivery",
      name: null,
      spec_item_ids: [],
    });
    const h = setup({ catalog: [delivery, second, installation, own] });

    await user.click(quickButton("Доставка"));

    expect(h.onCreateService).toHaveBeenCalledWith("delivery", null);
    expect(h.onAddExistingService).not.toHaveBeenCalled();
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("монтаж ведёт себя так же: своя услуга, а не чужая", async () => {
    const user = userEvent.setup();
    const h = setup();

    await user.click(quickButton("Монтаж"));

    expect(h.onCreateService).toHaveBeenCalledWith("installation", null);
    // Монтаж по умолчанию привязан к item-9, а не к материалу карточки.
    expect(h.onAddExistingService).not.toHaveBeenCalled();
  });

  it("кнопки нет, когда услуга этому материалу уже назначена", () => {
    setup({
      catalog: [{ ...delivery, spec_item_ids: [ITEM_ID] }, installation],
    });

    expect(screen.queryByRole("button", { name: "Доставка" })).toBeNull();
    expect(screen.getByRole("button", { name: "Монтаж" })).toBeTruthy();
  });

  it("запрещённый статус материала выключает кнопку с объяснением", () => {
    setup({ item: { ...TARGET, status: "delivered" } });

    const deliveryButton = quickButton("Доставка");
    expect(deliveryButton.hasAttribute("disabled")).toBe(true);
    expect(deliveryButton.getAttribute("title")).toContain("«Доставлено»");
    // Монтаж статусом «Доставлено» не ограничен — это правило только доставки.
    expect(quickButton("Монтаж").hasAttribute("disabled")).toBe(false);
  });

  it("заглушка не может войти в услугу — кнопка выключена", () => {
    setup({ item: { ...TARGET, isPlaceholder: true } });

    const deliveryButton = quickButton("Доставка");
    expect(deliveryButton.hasAttribute("disabled")).toBe(true);
    expect(deliveryButton.getAttribute("title")).toContain("Заглушку");
  });
});

/* ------------------------------------------------------------------ */
/*  Позиции операции в строке списка                                  */
/* ------------------------------------------------------------------ */

describe("AddServiceCombobox · позиции операции в строке", () => {
  it("строка называет позиции, которые уже в услуге", async () => {
    const user = userEvent.setup();
    setup({
      catalog: [
        op({ id: "op-shared", name: "Вывоз мусора", spec_item_ids: ["item-2", "item-9"] }),
      ],
    });
    await openCombobox(user);

    // Адресат виден кодами, а не только числом материалов.
    expect(within(list()).getByText("МД-02, ПЛ-09")).toBeTruthy();
  });

  it("услуга без привязок так и подписана", async () => {
    const user = userEvent.setup();
    setup({ catalog: [ownCleanup] });
    await openCombobox(user);

    expect(
      within(list()).getByText("ни к одной позиции не привязана"),
    ).toBeTruthy();
  });

  it("лишние позиции сворачиваются в «+N», полный список — в подсказке", async () => {
    const user = userEvent.setup();
    setup({
      catalog: [
        op({
          id: "op-shared",
          name: "Вывоз мусора",
          spec_item_ids: ["item-2", "item-9", "item-404"],
        }),
      ],
    });
    await openCombobox(user);

    expect(within(list()).getByText("МД-02, ПЛ-09 +1")).toBeTruthy();
    // Полный список — в подсказке; позиция, которой уже нет, в неё не попадает.
    const title = within(list())
      .getByText("Вывоз мусора")
      .closest("[cmdk-item]")
      ?.getAttribute("title");
    expect(title).toContain("МД-02 · Дуб натуральный");
    expect(title).toContain("ПЛ-09 · Плитка");
    expect(title).not.toContain("item-404");
  });

  it("текущий материал отмечен в строке видимо", async () => {
    const user = userEvent.setup();
    // «Подъём на этаж» связан с item-1 — это и есть материал карточки.
    setup();
    await openCombobox(user);

    expect(within(list()).getByText(/^уже в этом материале/)).toBeTruthy();
  });
});

/* ------------------------------------------------------------------ */
/*  Создание новой услуги                                             */
/* ------------------------------------------------------------------ */

describe("AddServiceCombobox · создание", () => {
  it("на новое название предлагается «Создать «…»»", async () => {
    const user = userEvent.setup();
    setup();
    await openCombobox(user);

    await type(user, "Вывоз упаковки");

    expect(screen.getByText("Создать «Вывоз упаковки»")).toBeTruthy();
  });

  it("сам по себе ввод текста услугу не создаёт", async () => {
    const user = userEvent.setup();
    const h = setup();
    await openCombobox(user);

    await type(user, "Вывоз упаковки");

    expect(h.onCreateService).not.toHaveBeenCalled();
    expect(h.onAddExistingService).not.toHaveBeenCalled();
  });

  it("явный выбор «Создать» открывает форму с набранным названием", async () => {
    const user = userEvent.setup();
    const h = setup();
    await openCombobox(user);

    await type(user, "Вывоз упаковки");
    await user.click(screen.getByText("Создать «Вывоз упаковки»"));

    // Форму открывает вызывающий — следующим кадром, уже после закрытия списка.
    // Тип приходит из команды: своя услуга — с набранным названием.
    await waitFor(() =>
      expect(h.onCreateService).toHaveBeenCalledWith("service", "Вывоз упаковки"),
    );
    expect(h.onAddExistingService).not.toHaveBeenCalled();
  });

  it("создание закрывает combobox — форму открывает вызывающий", async () => {
    const user = userEvent.setup();
    setup();
    await openCombobox(user);

    await type(user, "Вывоз упаковки");
    await user.click(screen.getByText("Создать «Вывоз упаковки»"));

    await waitFor(() =>
      expect(screen.queryByText("Создать «Вывоз упаковки»")).toBeNull(),
    );
  });

  it("без ввода предлагаются только фиксированные типы", async () => {
    const user = userEvent.setup();
    const h = setup();
    await openCombobox(user);

    // Своей услуги без названия в списке нет: имя своей услуги — это и есть то,
    // что вводят в поиск.
    expect(screen.queryByText("Создать услугу")).toBeNull();
    // А доставку и монтаж можно создать командой.
    expect(screen.getByText("Создать доставку")).toBeTruthy();
    expect(screen.getByText("Создать монтаж")).toBeTruthy();

    await user.click(screen.getByText("Создать монтаж"));

    await waitFor(() =>
      expect(h.onCreateService).toHaveBeenCalledWith("installation", null),
    );
  });

  it("команды фиксированных типов исчезают, когда услуга уже назначена", async () => {
    const user = userEvent.setup();
    // Доставка уже связана с материалом карточки, монтаж — нет.
    setup({
      catalog: [{ ...delivery, spec_item_ids: [ITEM_ID] }, installation],
    });
    await openCombobox(user);

    expect(screen.queryByText("Создать доставку")).toBeNull();
    expect(screen.getByText("Создать монтаж")).toBeTruthy();
    // Правило объясняет сама привязанная доставка: она в списке и недоступна.
    expect(
      row("Доставка").closest("[cmdk-item]")?.getAttribute("aria-disabled"),
    ).toBe("true");
  });

  it("услуг пока нет: пустое состояние и команды создания остаются", async () => {
    const user = userEvent.setup();
    const h = setup({ catalog: [] });
    await openCombobox(user);

    expect(screen.getByText("Услуг пока нет")).toBeTruthy();
    await user.click(screen.getByText("Создать доставку"));

    await waitFor(() =>
      expect(h.onCreateService).toHaveBeenCalledWith("delivery", null),
    );
  });

  it("чужая доставка или монтаж недоступны, если материал уже в другой такой операции", async () => {
    const user = userEvent.setup();
    setup({
      catalog: [
        { ...delivery, spec_item_ids: [ITEM_ID] },
        op({ id: "op-delivery-2", type: "delivery", name: null, spec_item_ids: [] }),
        { ...installation, spec_item_ids: [ITEM_ID] },
        op({
          id: "op-installation-2",
          type: "installation",
          name: null,
          spec_item_ids: [],
        }),
      ],
    });
    await openCombobox(user);

    const rowFor = (label: string, hint: string) =>
      screen
        .getAllByText(label)
        .map((el) => el.closest("[cmdk-item]"))
        .find((row) => row?.textContent?.includes(hint));

    // Сервер отклонил бы такую привязку, поэтому строка недоступна и объяснена.
    expect(
      rowFor("Доставка", "уже в другой доставке")?.getAttribute("aria-disabled"),
    ).toBe("true");
    expect(
      rowFor("Монтаж", "уже в другом монтаже")?.getAttribute("aria-disabled"),
    ).toBe("true");
    expect(screen.queryByText("Создать доставку")).toBeNull();
    expect(screen.queryByText("Создать монтаж")).toBeNull();
  });

  it("созданная услуга видна при повторном открытии combobox", async () => {
    const user = userEvent.setup();
    const created = op({
      id: "op-new",
      type: "service",
      name: "Вывоз упаковки",
      amount: 1500,
      spec_item_ids: [ITEM_ID],
    });
    const h = setup();
    await openCombobox(user);

    await type(user, "Вывоз упаковки");
    await user.click(screen.getByText("Создать «Вывоз упаковки»"));
    await waitFor(() =>
      expect(h.onCreateService).toHaveBeenCalledWith("service", "Вывоз упаковки"),
    );

    // Родитель положил созданную услугу в список без перезагрузки страницы
    // (`onOperationCreated`): она уже связана с материалом карточки.
    h.rerender(
      <AddServiceCombobox
        item={TARGET}
        items={ITEMS}
        catalog={[created, delivery, own]}
        onAddExistingService={h.onAddExistingService}
        onCreateService={h.onCreateService}
      />,
    );

    await openCombobox(user);

    expect(screen.getByText(/^Вывоз упаковки/)).toBeTruthy();
    // И она же уже отмечена связанной с материалом.
    expect(
      screen.getByText("Вывоз упаковки").closest("[cmdk-item]")?.getAttribute(
        "aria-disabled",
      ),
    ).toBe("true");
  });
});

/* ------------------------------------------------------------------ */
/*  Дубликаты                                                         */
/* ------------------------------------------------------------------ */

describe("AddServiceCombobox · дубликаты", () => {
  it("для существующего названия создание не предлагается", async () => {
    const user = userEvent.setup();
    setup();
    await openCombobox(user);

    await type(user, "Подъём на этаж");

    // Строки создания нет вовсе: услуга с таким названием уже стоит в списке
    // выше, и создавать её заново нечем.
    expect(screen.queryByText(/^Создать «/)).toBeNull();
    expect(screen.queryByText(/уже есть в услугах/)).toBeNull();
    expect(screen.getByText(/^Подъём на этаж/)).toBeTruthy();
  });

  it("регистр и пробелы не делают название новым", async () => {
    const user = userEvent.setup();
    setup();
    await openCombobox(user);

    await type(user, "  подъём НА этаж ");

    expect(screen.queryByText(/^Создать «/)).toBeNull();
  });

  it("«Доставка» — имя фиксированного типа, а не своей услуги", async () => {
    const user = userEvent.setup();
    const h = setup();
    await openCombobox(user);

    await type(user, "доставка");

    // Своей услугой это имя занять нельзя даже без доставки в проекте...
    expect(screen.queryByText(/^Создать «/)).toBeNull();
    // ...а команда создания доставки по этому запросу на месте.
    await user.click(screen.getByText("Создать доставку"));

    await waitFor(() =>
      expect(h.onCreateService).toHaveBeenCalledWith("delivery", null),
    );
  });

  it("совпадение показывается, а создать дубликат нельзя", async () => {
    const user = userEvent.setup();
    setup();
    await openCombobox(user);

    await type(user, "Уборка");

    // Название ищется подстрокой: в строке услуги рядом стоят подпись связей и
    // сумма, поэтому точное совпадение текста здесь не подходит.
    expect(within(list()).getByText(/^Уборка/)).toBeTruthy();
    expect(screen.queryByText(/^Создать «/)).toBeNull();
  });

  it("своя услуга создаётся только для свободного названия", async () => {
    const user = userEvent.setup();
    const h = setup();
    await openCombobox(user);

    // Пустое поле: имя своей услуги — это и есть то, что вводят в поиск.
    expect(screen.queryByText("Создать услугу")).toBeNull();

    await type(user, "Вывоз упаковки");
    await user.click(screen.getByText("Создать «Вывоз упаковки»"));

    await waitFor(() =>
      expect(h.onCreateService).toHaveBeenCalledWith("service", "Вывоз упаковки"),
    );
  });

  it("повторный клик во время привязки не создаёт вторую услугу", async () => {
    const user = userEvent.setup();
    let release: (value: boolean) => void = () => {};
    const onAddExistingService = vi.fn(
      () => new Promise<boolean>((resolve) => (release = resolve)),
    );
    render(
      <AddServiceCombobox
        item={TARGET}
        items={ITEMS}
        catalog={[delivery]}
        onAddExistingService={onAddExistingService}
        onCreateService={vi.fn()}
      />,
    );

    await openCombobox(user);
    await user.click(row("Доставка"));
    // Второй клик по строке, пока первый запрос ещё в пути.
    await user.click(row("Доставка"));

    expect(onAddExistingService).toHaveBeenCalledTimes(1);

    release(true);
    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
    expect(onAddExistingService).toHaveBeenCalledTimes(1);
  });
});

/* ------------------------------------------------------------------ */
/*  Ошибки и загрузка                                                 */
/* ------------------------------------------------------------------ */

describe("AddServiceCombobox · ошибки и загрузка", () => {
  it("загрузка списка показывается отдельным состоянием", async () => {
    const user = userEvent.setup();
    setup({ loading: true, catalog: [] });
    await openCombobox(user);

    expect(screen.getByText("Загружаем услуги…")).toBeTruthy();
    expect(screen.queryByText("Услуг пока нет")).toBeNull();
  });

  it("ошибка загрузки списка не выглядит как «услуг нет»", async () => {
    const user = userEvent.setup();
    const onRetryCatalog = vi.fn();
    setup({ catalogError: "Не удалось загрузить услуги", onRetryCatalog });
    await openCombobox(user);

    expect(screen.getByRole("alert").textContent).toContain(
      "Не удалось загрузить услуги",
    );
    expect(screen.queryByText("Услуг пока нет")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Повторить" }));
    expect(onRetryCatalog).toHaveBeenCalledTimes(1);
  });

  it("при ошибке загрузки список услуг и создание не показываются", async () => {
    const user = userEvent.setup();
    setup({ catalogError: "Не удалось загрузить услуги" });
    await openCombobox(user);

    // В списке не остаётся ни одной выбираемой строки: список не загрузился.
    expect(screen.queryByRole("option")).toBeNull();
    expect(screen.queryByText(/^Создать «/)).toBeNull();
    expect(screen.queryByText("Создать услугу")).toBeNull();
    // Команды создания тоже не показываются: список не загрузился, выбирать
    // нечего — и создавать не от чего отталкиваться.
    expect(screen.queryByText("Создать доставку")).toBeNull();
    expect(screen.queryByText("Создать монтаж")).toBeNull();
    // Кнопки быстрого добавления при этом на месте, но нажать их нельзя: по
    // незагруженному каталогу нельзя решить, есть ли уже доставка в проекте.
    expect(quickButton("Доставка").hasAttribute("disabled")).toBe(true);
  });

  it("ошибка привязки оставляет combobox открытым и позволяет повторить", async () => {
    const user = userEvent.setup();
    const h = setup({ addResult: false });
    await openCombobox(user);

    await user.click(row("Доставка"));

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(
        "Не удалось добавить услугу к материалу",
      ),
    );
    // Список остался на месте: выбор можно повторить.
    expect(row("Доставка")).toBeTruthy();

    await user.click(row("Доставка"));
    await waitFor(() => expect(h.onAddExistingService).toHaveBeenCalledTimes(2));
  });

  it("во время привязки показывается состояние загрузки", async () => {
    const user = userEvent.setup();
    let release: (value: boolean) => void = () => {};
    const onAddExistingService = vi.fn(
      () => new Promise<boolean>((resolve) => (release = resolve)),
    );
    render(
      <AddServiceCombobox
        item={TARGET}
        items={ITEMS}
        catalog={[delivery]}
        onAddExistingService={onAddExistingService}
        onCreateService={vi.fn()}
      />,
    );

    await openCombobox(user);
    await user.click(row("Доставка"));

    expect(screen.getByRole("status").textContent).toContain("Добавляем");
    release(true);
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
  });
});

/* ------------------------------------------------------------------ */
/*  Доступность                                                       */
/* ------------------------------------------------------------------ */

describe("AddServiceCombobox · доступность", () => {
  it("Escape закрывает combobox", async () => {
    const user = userEvent.setup();
    setup();
    await openCombobox(user);

    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
  });

  it("стрелка перемещает активный пункт, Enter его выбирает", async () => {
    const user = userEvent.setup();
    const h = setup();
    await openCombobox(user);

    // Первой активной строкой cmdk делает «Доставку»; одна стрелка вниз
    // переводит выбор на «Монтаж».
    await user.keyboard("{ArrowDown}");
    await user.keyboard("{Enter}");

    await waitFor(() =>
      expect(h.onAddExistingService).toHaveBeenCalledWith(installation),
    );
  });

  it("Enter на набранном названии открывает создание", async () => {
    const user = userEvent.setup();
    const h = setup();
    await openCombobox(user);

    await type(user, "Монтаж стен");
    await user.keyboard("{Enter}");

    // Команды фиксированных типов по этому запросу отфильтрованы, поэтому
    // активной строкой остаётся создание своей услуги с набранным именем, а не
    // «Создать монтаж».
    await waitFor(() =>
      expect(h.onCreateService).toHaveBeenCalledWith("service", "Монтаж стен"),
    );
  });

  it("у триггера доступное название и состояние раскрытия", async () => {
    const user = userEvent.setup();
    setup();

    expect(trigger().getAttribute("aria-expanded")).toBe("false");

    await user.click(trigger());
    expect(trigger().getAttribute("aria-expanded")).toBe("true");
  });

  it("поле поиска доступно с понятным названием", async () => {
    const user = userEvent.setup();
    setup();
    await openCombobox(user);

    expect(search()).toBeTruthy();
  });

  it("список услуг подписан", async () => {
    const user = userEvent.setup();
    setup();
    await openCombobox(user);

    expect(
      screen.getByRole("listbox", { name: "Услуги проекта" }),
    ).toBeTruthy();
  });
});

/* ------------------------------------------------------------------ */
/*  Тип услуги в форме                                                */
/* ------------------------------------------------------------------ */

describe("ServiceTypeCombobox · тип услуги в форме", () => {
  const typeTrigger = () =>
    screen.getByRole("combobox", { name: "Тип услуги" });
  const typeSearch = () =>
    screen.getByRole("combobox", { name: "Найти или создать тип…" });

  function setupType({
    type = "service",
    usedCustomNames = [],
  }: {
    type?: ServiceOperationType;
    usedCustomNames?: string[];
  } = {}) {
    const onChange = vi.fn();
    render(
      <ServiceTypeCombobox
        type={type}
        onChange={onChange}
        usedCustomNames={usedCustomNames}
      />,
    );
    return onChange;
  }

  it("показывает текущий тип: у своей услуги — «Своя услуга»", () => {
    setupType();

    expect(typeTrigger().textContent).toContain("Своя услуга");
  });

  it("показывает текущий фиксированный тип его подписью", () => {
    setupType({ type: "delivery" });

    expect(typeTrigger().textContent).toContain("Доставка");
  });

  it("в списке есть «Доставка» и «Монтаж»", async () => {
    const user = userEvent.setup();
    setupType();

    await user.click(typeTrigger());

    expect(screen.getByText("Доставка")).toBeTruthy();
    expect(screen.getByText("Монтаж")).toBeTruthy();
  });

  it("выбор «Монтаж» отдаёт фиксированный тип", async () => {
    const user = userEvent.setup();
    const onChange = setupType();
    await user.click(typeTrigger());

    await user.click(screen.getByText("Монтаж"));

    expect(onChange).toHaveBeenCalledWith({
      kind: "fixed",
      type: "installation",
    });
  });

  it("выбор «Доставка» отдаёт фиксированный тип", async () => {
    const user = userEvent.setup();
    const onChange = setupType();
    await user.click(typeTrigger());

    await user.click(screen.getByText("Доставка"));

    expect(onChange).toHaveBeenCalledWith({ kind: "fixed", type: "delivery" });
  });

  it("поиск внутри списка типов фильтрует пункты", async () => {
    const user = userEvent.setup();
    setupType();
    await user.click(typeTrigger());

    await user.type(typeSearch(), "мон");

    expect(screen.getByText("Монтаж")).toBeTruthy();
    expect(screen.queryByText("Доставка")).toBeNull();
  });

  it("новое название создаёт свою услугу с этим названием", async () => {
    const user = userEvent.setup();
    const onChange = setupType();
    await user.click(typeTrigger());

    await user.type(typeSearch(), "Вывоз упаковки");
    await user.click(screen.getByText("Создать «Вывоз упаковки»"));

    expect(onChange).toHaveBeenCalledWith({
      kind: "custom",
      name: "Вывоз упаковки",
    });
  });

  it("пустой ввод создаёт свою услугу без названия", async () => {
    const user = userEvent.setup();
    const onChange = setupType();
    await user.click(typeTrigger());

    await user.click(screen.getByText("Создать услугу"));

    expect(onChange).toHaveBeenCalledWith({ kind: "custom", name: null });
  });

  it("название существующей своей услуги дубликатом не создаётся", async () => {
    const user = userEvent.setup();
    const onChange = setupType({ usedCustomNames: ["Подъём на этаж"] });
    await user.click(typeTrigger());

    await user.type(typeSearch(), "подъём НА этаж");

    expect(screen.queryByText(/^Создать «/)).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("имя фиксированного типа своей услугой не создаётся", async () => {
    const user = userEvent.setup();
    const onChange = setupType();
    await user.click(typeTrigger());

    await user.type(typeSearch(), "Доставка");

    // Строка не предлагает создать «Доставку» как свою услугу: для этого типа
    // есть отдельный пункт «Доставка» выше.
    expect(screen.getByText("«Доставка» — имя фиксированного типа")).toBeTruthy();
    expect(screen.queryByText(/^Создать «/)).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("Escape закрывает список типов", async () => {
    const user = userEvent.setup();
    setupType();
    await user.click(typeTrigger());

    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByText("Монтаж")).toBeNull());
  });
});
