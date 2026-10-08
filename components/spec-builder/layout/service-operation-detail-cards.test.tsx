import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ServiceOperationDetailCards } from "./service-operation-detail-cards";
import type { ServiceOperation } from "@/actions/service-operations";

/**
 * Строка услуги в блоке «Услуги»: завершённая доставка не показывает срок.
 *
 * Проверяется именно отображение строки, а не расчёт: даты взяты заведомо
 * далёкие от сегодняшнего дня (2000 и 2999 год), поэтому тесты не зависят от
 * того, когда их запустили, и «через N дн.»/«просрочено N дн.» для завершённой
 * доставки не могут появиться ни при какой текущей дате.
 *
 * Тексты ищутся по регулярному выражению «N дн.» — число дней в ожидании не
 * фиксируется, чтобы тест не пришлось переписывать со сменой даты.
 */

const PAST = "2000-01-01"; // заведомо прошедшая дата
const FUTURE = "2999-01-01"; // заведомо будущая дата

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

function renderOps(op: ServiceOperation) {
  return render(
    <ServiceOperationDetailCards ops={[op]} onOpenOperation={vi.fn()} />,
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
    // Срок не отрисован вовсе: иконки часов нет, есть только иконка операции.
    expect(container.querySelectorAll("svg")).toHaveLength(1);
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
