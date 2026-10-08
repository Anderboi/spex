import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ServiceOperationBadges } from "./service-operation-badges";
import { fmtCompact } from "@/lib/utils";
import type { ServiceOperation } from "@/actions/service-operations";

/**
 * Бейджи операций в строке таблицы: завершённая доставка не подсвечивается
 * просрочкой.
 *
 * Это второй производный индикатор срока (красный цвет суммы и «!» у операции):
 * он считается отдельно от текста «просрочено N дн.», поэтому проверяется
 * отдельно. Даты взяты заведомо далёкие от сегодняшнего дня (2000 и 2999 год),
 * чтобы тест не зависел от даты запуска.
 *
 * Плановая дата при этом не пропадает: она остаётся в подсказке строки как
 * исторические данные.
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

describe("ServiceOperationBadges · просрочка доставки", () => {
  it("delivered + прошедшая дата: индикатора просрочки нет", () => {
    const { container, row } = renderBadges(
      delivery({ completed: true, deadline: PAST }),
    );

    expect(screen.getByText(`${fmtCompact(12_000)} ₽`)).toBeTruthy();
    expect(container.querySelector(".text-fg-red")).toBeNull();
    // Только иконка операции: «!» просрочки не отрисован.
    expect(container.querySelectorAll("svg")).toHaveLength(1);
    // Плановая дата сохранена — она просто больше не дедлайн.
    const date = new Date(`${PAST}T00:00:00`).toLocaleDateString("ru-RU");
    expect(row.getAttribute("title")).toContain(`срок: ${date}`);
  });

  it("delivered + будущая дата: индикатора просрочки нет", () => {
    const { container } = renderBadges(
      delivery({ completed: true, deadline: FUTURE }),
    );

    expect(container.querySelector(".text-fg-red")).toBeNull();
    expect(container.querySelectorAll("svg")).toHaveLength(1);
  });

  it("незавершённая доставка + прошедшая дата: просрочка сохраняется", () => {
    const { container } = renderBadges(delivery({ deadline: PAST }));

    expect(container.querySelector(".text-fg-red")).not.toBeNull();
    // Иконка операции + «!» просрочки.
    expect(container.querySelectorAll("svg")).toHaveLength(2);
  });

  it("незавершённая доставка + будущая дата: просрочки нет", () => {
    const { container } = renderBadges(delivery({ deadline: FUTURE }));

    expect(container.querySelector(".text-fg-red")).toBeNull();
    expect(container.querySelectorAll("svg")).toHaveLength(1);
  });
});
