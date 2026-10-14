import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CompanyCard } from "./company-card";
import type { CompanyRow } from "@/lib/validations";

/**
 * Компактный переход в библиотеку материалов на карточке компании.
 *
 * Проверяется связка «карточка компании → библиотека материалов»: ссылка обязана
 * нести фильтр именно по этой компании (`?company=<id>`), а число материалов —
 * попадать в доступное имя, потому что видимого текста у кнопки нет: только
 * «куб», число и стрелка ↗.
 *
 * Отдельно закреплены два края: при нуле материалов кнопки нет вовсе (не должно
 * оставаться кликабельного элемента, ведущего на пустой результат), а при
 * неизвестном числе (счётчик не посчитался) кнопка остаётся — путь в библиотеку
 * нужен и тогда, числа просто нет.
 */

const COMPANY_ID = "11111111-1111-1111-1111-111111111111";

function company(overrides: Partial<CompanyRow> = {}): CompanyRow {
  return {
    id: COMPANY_ID,
    name: "Kerama Marazzi",
    phone: null,
    email: null,
    website: null,
    address: null,
    category: [],
    note: null,
    logo_url: null,
    ...overrides,
  };
}

/** Ищем именно кнопку материалов: реквизиты компании тоже могут быть ссылками. */
const materialsLink = () =>
  screen.queryByRole("link", { name: /Материалы поставщика/ });

function renderCard(materialCount?: number) {
  render(
    <CompanyCard
      company={company()}
      orgSlug="studio"
      materialCount={materialCount}
      managers={[]}
      onOpenContacts={vi.fn()}
      onEditCompany={vi.fn()}
      onRemoveCompany={vi.fn()}
    />,
  );
}

afterEach(cleanup);

describe("CompanyCard · материалы компании", () => {
  it("ссылка ведёт в библиотеку с фильтром по этой компании", () => {
    renderCard(3);

    expect(materialsLink()?.getAttribute("href")).toBe(
      `/studio/materials?company=${COMPANY_ID}`,
    );
  });

  it("число материалов видно и названо словами", () => {
    renderCard(3);
    const link = materialsLink();

    expect(link?.textContent).toBe("3");
    expect(link?.getAttribute("aria-label")).toBe(
      "Материалы поставщика Kerama Marazzi: 3, открыть в библиотеке",
    );
    // Подсказка при наведении повторяет доступное имя: другого текста у кнопки нет.
    expect(link?.getAttribute("title")).toBe(link?.getAttribute("aria-label"));
  });

  it("нет материалов — нет кнопки", () => {
    renderCard(0);

    expect(materialsLink()).toBeNull();
    // Строка контактов при этом на месте: без материалов она остаётся целой.
    expect(
      screen.getByRole("button", { name: /Контакты компании/ }),
    ).toBeTruthy();
  });

  it("счётчик не посчитался — кнопка остаётся, числа при ней нет", () => {
    renderCard();
    const link = materialsLink();

    expect(link).toBeTruthy();
    expect(link?.textContent).toBe("");
    expect(link?.getAttribute("aria-label")).toBe(
      "Материалы поставщика Kerama Marazzi, открыть в библиотеке",
    );
  });
});
