import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ServiceOperationDetailCards } from "./service-operation-detail-cards";
import { fmt } from "@/lib/utils";
import type { ServiceOperation } from "@/actions/service-operations";

/**
 * Блок «Услуги» карточки материала: строка услуги и добавление новой.
 *
 * Здесь две группы проверок. Первая — отображение строки: завершённая доставка
 * не показывает срок. Даты взяты заведомо далёкие от сегодняшнего дня (2000 и
 * 2999 год), поэтому тесты не зависят от того, когда их запустили, а «через
 * N дн.»/«просрочено N дн.» ищутся регулярным выражением, чтобы число дней не
 * фиксировалось.
 *
 * Вторая — что добавление услуги живёт в Createable Combobox, а не в
 * отдельной кнопке: «Доставка» и «Монтаж» — обычные услуги проекта, и в блоке
 * нет кнопок под конкретный их тип. Поведение самого combobox проверяется в
 * `add-service-combobox.test.tsx`; здесь — только его место в блоке.
 */

const PAST = "2000-01-01"; // заведомо прошедшая дата
const FUTURE = "2999-01-01"; // заведомо будущая дата

/** Позиция карточки: к ней привязываются услуги. */
const TARGET = {
  id: "item-1",
  code: "КР-01",
  name: "Керамогранит",
  status: "picked" as const,
  isPlaceholder: false,
};

/** Позиции проекта: по ним строки услуг называют свои позиции. */
const ALL_ITEMS = [
  { id: "item-1", code: "КР-01", name: "Керамогранит" },
  { id: "item-2", code: "МД-02", name: "Дуб натуральный" },
];

const OVERDUE_RE = /^просрочено \d+ дн\.$/;
const UPCOMING_RE = /^через \d+ дн\.$/;

function delivery(overrides: Partial<ServiceOperation> = {}): ServiceOperation {
  return {
    id: "op-delivery",
    type: "delivery",
    name: null,
    amount: 12_000,
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

function renderOps(op: ServiceOperation, catalog: ServiceOperation[] = [op]) {
  return render(
    <ServiceOperationDetailCards
      item={TARGET}
      ops={[op]}
      serviceCatalog={catalog}
      onOpenOperation={vi.fn()}
      onAddExistingService={vi.fn(async () => true)}
      onCreateService={vi.fn()}
      allItems={ALL_ITEMS}
      onRetryServiceCatalog={vi.fn()}
      serviceCatalogError={null}
      serviceCatalogLoading={false}
    />,
  );
}

/** Блок без услуг: пустое состояние и триггер добавления. */
function renderEmpty(catalog: ServiceOperation[] = []) {
  return render(
    <ServiceOperationDetailCards
      item={TARGET}
      ops={[]}
      serviceCatalog={catalog}
      onOpenOperation={vi.fn()}
      onAddExistingService={vi.fn(async () => true)}
      onCreateService={vi.fn()}
      allItems={ALL_ITEMS}
      onRetryServiceCatalog={vi.fn()}
      serviceCatalogError={null}
      serviceCatalogLoading={false}
    />,
  );
}

afterEach(cleanup);

describe("ServiceOperationDetailCards · срок доставки", () => {
  it("delivered + прошедшая дата: «просрочено N дн.» не показывается", () => {
    const { container } = renderOps(
      delivery({ completed: true, deadline: PAST }),
    );

    expect(screen.getByText("Доставка")).toBeTruthy();
    expect(screen.getByText("исполнена")).toBeTruthy();
    expect(screen.queryByText(OVERDUE_RE)).toBeNull();
    expect(screen.queryByText(UPCOMING_RE)).toBeNull();
    expect(screen.queryByText("сегодня")).toBeNull();
    // Другого производного индикатора просрочки в строке тоже нет.
    expect(container.querySelector(".text-fg-red")).toBeNull();
  });

  it("delivered + будущая дата: «через N дн.» не показывается", () => {
    renderOps(delivery({ completed: true, deadline: FUTURE }));

    expect(screen.queryByText(UPCOMING_RE)).toBeNull();
    expect(screen.queryByText(OVERDUE_RE)).toBeNull();
    expect(screen.queryByText("сегодня")).toBeNull();
  });

  it("delivered: срок не зависит от текущей даты", () => {
    const { container } = renderOps(
      delivery({ completed: true, deadline: PAST }),
    );
    // Срок не отрисован вовсе: в строке нет иконки часов — только иконка
    // услуги. Считаем иконки внутри строки, а не по документу: триггер
    // combobox добавления услуги приносит свои иконки и к сроку отношения не
    // имеет.
    const row = container.querySelector("button");
    expect(row?.querySelectorAll("svg")).toHaveLength(1);
    expect(row?.querySelector("svg")?.getAttribute("class")).toContain(
      "lucide-truck",
    );
  });

  it("незавершённая доставка + будущая дата: «через N дн.» остаётся", () => {
    const { container } = renderOps(delivery({ deadline: FUTURE }));

    const note = screen.getByText(UPCOMING_RE);
    expect(note.textContent).toMatch(UPCOMING_RE);
    expect(note.className).not.toContain("text-fg-red");
    expect(screen.getByText("не исполнена")).toBeTruthy();
    expect(container.querySelector(".text-fg-red")).toBeNull();
  });

  it("незавершённая доставка + прошедшая дата: «просрочено N дн.» остаётся", () => {
    renderOps(delivery({ deadline: PAST }));

    const note = screen.getByText(OVERDUE_RE);
    expect(note.textContent).toMatch(OVERDUE_RE);
    expect(note.className).toContain("text-fg-red");
  });

  it("доставка без даты: срок не показывается", () => {
    renderOps(delivery({ deadline: null }));

    expect(screen.queryByText(UPCOMING_RE)).toBeNull();
    expect(screen.queryByText(OVERDUE_RE)).toBeNull();
    expect(screen.queryByText("сегодня")).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/*  Добавление услуги                                                 */
/* ------------------------------------------------------------------ */

describe("ServiceOperationDetailCards · добавление услуги", () => {
  it("услуга добавляется через combobox, а не отдельной кнопкой", () => {
    renderOps(delivery());

    expect(
      screen.getByRole("combobox", { name: "Добавить услугу" }),
    ).toBeTruthy();
  });

  it("создание услуги живёт в combobox, а в блоке — только быстрые кнопки типов", () => {
    renderOps(delivery());

    // Кнопок «Добавить доставку»/«Создать …» в блоке нет: создание идёт из
    // списка combobox. Быстрые кнопки названы типом, а не действием.
    const names = screen
      .getAllByRole("button")
      .map((b) => b.textContent ?? "");
    expect(names.filter((n) => /добавить|создать/i.test(n))).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Монтаж" })).toBeTruthy();
  });

  it("быстрая кнопка типа открывает форму создания этой услуги", async () => {
    const user = userEvent.setup();
    const onCreateService = vi.fn();
    render(
      <ServiceOperationDetailCards
        item={TARGET}
        allItems={ALL_ITEMS}
        ops={[delivery()]}
        serviceCatalog={[delivery()]}
        onOpenOperation={vi.fn()}
        onAddExistingService={vi.fn(async () => true)}
        onCreateService={onCreateService}
        onRetryServiceCatalog={vi.fn()}
        serviceCatalogError={null}
        serviceCatalogLoading={false}
      />,
    );

    // Монтажа в проекте нет — кнопка открывает форму создания монтажа; сама
    // операция появится по сохранению формы.
    await user.click(screen.getByRole("button", { name: "Монтаж" }));

    expect(onCreateService).toHaveBeenCalledWith("installation", null);
  });

  it("в списке combobox видны существующие услуги проекта", async () => {
    const user = userEvent.setup();
    const installation = delivery({
      id: "op-installation",
      type: "installation",
      amount: 8000,
      spec_item_ids: [],
    });
    renderOps(delivery(), [delivery(), installation]);

    await user.click(screen.getByRole("combobox", { name: "Добавить услугу" }));

    expect(
      within(screen.getByRole("listbox", { name: "Услуги проекта" })).getByText(
        "Монтаж",
      ),
    ).toBeTruthy();
  });

  it("пустой список услуг: блок зовёт выбрать или создать услугу", () => {
    const { container } = renderEmpty();

    expect(container.textContent).toContain("Услуг по позиции нет");
    expect(
      screen.getByRole("combobox", { name: "Добавить услугу" }),
    ).toBeTruthy();
  });
});

/* ------------------------------------------------------------------ */
/*  Сумма операции — общая, а не расход позиции                       */
/* ------------------------------------------------------------------ */

describe("ServiceOperationDetailCards · общая сумма услуги", () => {
  it("итога услуг над блоком нет", () => {
    render(
      <ServiceOperationDetailCards
        item={TARGET}
        ops={[
          delivery({ amount: 40_000, spec_item_ids: ["item-1"] }),
          delivery({
            id: "op-installation",
            type: "installation",
            amount: 8000,
            spec_item_ids: ["item-1", "item-2"],
          }),
        ]}
        serviceCatalog={[]}
        onOpenOperation={vi.fn()}
        onAddExistingService={vi.fn(async () => true)}
        onCreateService={vi.fn()}
        allItems={ALL_ITEMS}
        onRetryServiceCatalog={vi.fn()}
        serviceCatalogError={null}
        serviceCatalogLoading={false}
      />,
    );

    // 48 000 ₽ сложились бы из общей суммы доставки и монтажа: в карточке одной
    // позиции это читалось бы как её расход. Показываются суммы самих операций.
    // Строки собираются через fmt: разделитель разрядов — не обычный пробел.
    expect(screen.queryByText(`${fmt(48_000)} ₽`)).toBeNull();
    expect(screen.getByText(`${fmt(40_000)} ₽`)).toBeTruthy();
    expect(screen.getByText(`${fmt(8000)} ₽`)).toBeTruthy();
  });

  it("рядом с суммой видно, сколько ещё материалов покрывает операция", () => {
    renderOps(
      delivery({ spec_item_ids: ["item-1", "item-2", "item-3"] }),
    );

    expect(screen.getByText(/ещё 2 материала/)).toBeTruthy();
  });

  it("у операции с одной позицией пометки общности нет", () => {
    const { container } = renderOps(delivery({ spec_item_ids: ["item-1"] }));

    expect(container.textContent).not.toContain("ещё");
  });

  it("«исполнена» показывается у любого типа, не только у доставки", () => {
    renderOps(
      delivery({
        type: "service",
        name: "Подъём на этаж",
        completed: true,
        spec_item_ids: ["item-1"],
      }),
    );

    expect(screen.getByText("Подъём на этаж")).toBeTruthy();
    expect(screen.getByText("исполнена")).toBeTruthy();
  });
});
