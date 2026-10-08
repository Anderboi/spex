import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ServiceOperationBadges } from "./service-operation-badges";
import { fmt } from "@/lib/utils";
import type { ServiceOperation } from "@/actions/service-operations";

/**
 * Бейджи операций в строке таблицы.
 *
 * Два правила проверяются здесь:
 *
 * 1. Исполненная операция не подсвечивается просрочкой. Это второй производный
 *    индикатор срока (красный цвет и «!»), он считается отдельно от текста
 *    «просрочено N дн.», поэтому проверяется отдельно. Даты взяты заведомо
 *    далёкие от сегодняшнего дня (2000 и 2999 год), чтобы тест не зависел от
 *    даты запуска. Отметка терминальна для любого типа операции, а не только
 *    для доставки.
 * 2. Суммы операции в бейдже нет: она одна на все позиции операции и в строке
 *    одной позиции читалась бы как её расход. Сумма, срок и подрядчик остаются
 *    в подсказке строки.
 */

const PAST = "2000-01-01";
const FUTURE = "2999-01-01";

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

function renderBadges(op: ServiceOperation) {
  const { container } = render(
    <ServiceOperationBadges ops={[op]} onOpen={vi.fn()} />,
  );
  return { container, row: screen.getByRole("button") };
}

afterEach(cleanup);

describe("ServiceOperationBadges · просрочка операции", () => {
  it("исполнено + прошедшая дата: индикатора просрочки нет", () => {
    const { container, row } = renderBadges(
      delivery({ completed: true, deadline: PAST }),
    );

    expect(container.querySelector(".text-fg-red")).toBeNull();
    // Только иконка операции: «!» просрочки не отрисован.
    expect(container.querySelectorAll("svg")).toHaveLength(1);
    // Плановая дата сохранена — она просто больше не дедлайн.
    const date = new Date(`${PAST}T00:00:00`).toLocaleDateString("ru-RU");
    expect(row.getAttribute("title")).toContain(`срок: ${date}`);
  });

  it("исполнено + будущая дата: индикатора просрочки нет", () => {
    const { container } = renderBadges(
      delivery({ completed: true, deadline: FUTURE }),
    );

    expect(container.querySelector(".text-fg-red")).toBeNull();
    expect(container.querySelectorAll("svg")).toHaveLength(1);
  });

  it("не исполнено + прошедшая дата: просрочка сохраняется", () => {
    const { container } = renderBadges(delivery({ deadline: PAST }));

    expect(container.querySelector(".text-fg-red")).not.toBeNull();
    // Иконка операции + «!» просрочки.
    expect(container.querySelectorAll("svg")).toHaveLength(2);
  });

  it("не исполнено + будущая дата: просрочки нет", () => {
    const { container } = renderBadges(delivery({ deadline: FUTURE }));

    expect(container.querySelector(".text-fg-red")).toBeNull();
    expect(container.querySelectorAll("svg")).toHaveLength(1);
  });

  it("отметка снимает просрочку у любого типа операции, не только у доставки", () => {
    const installation = renderBadges(
      delivery({ type: "installation", completed: true, deadline: PAST }),
    );
    expect(installation.container.querySelector(".text-fg-red")).toBeNull();

    cleanup();
    const own = renderBadges(
      delivery({
        type: "service",
        name: "Подъём на этаж",
        completed: true,
        deadline: PAST,
      }),
    );
    expect(own.container.querySelector(".text-fg-red")).toBeNull();
  });

  it("суммы операции в бейдже нет — она остаётся в подсказке", () => {
    const { container, row } = renderBadges(
      delivery({ completed: true, deadline: PAST }),
    );

    // «12 000 ₽» в разметке не отрисовано: сумма общая на все позиции операции.
    expect(container.textContent).not.toContain("₽");
    expect(row.getAttribute("title")).toContain(`${fmt(12_000)} ₽`);
  });
});
