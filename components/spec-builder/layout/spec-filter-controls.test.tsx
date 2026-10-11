import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  SpecDraftsToggle,
  SpecStatusSelect,
  SpecSupplierSelect,
} from "./spec-filter-controls";
import { ALL_CATEGORIES } from "@/lib/constants";
import { specItem as item } from "@/tests/factories/spec-item";
import type { SpecFilters } from "@/hooks/use-spec-filters";

/**
 * Контролы фильтров спецификации: статус, поставщик и «черновики».
 *
 * Правила выборки проверяются в `lib/spec/list-filters.test.ts`; здесь — только
 * то, что видно и нажимается: подписи триггеров, выключенное состояние и то,
 * что активный фильтр из URL остаётся видимым. Список пунктов селекта не
 * открывается нарочно: попап base-ui в happy-dom не рендерится, и такой тест
 * проверял бы среду, а не разметку (см. падающие тесты комбобоксов услуг).
 */

function filters(overrides: Partial<SpecFilters> = {}): SpecFilters {
  return {
    query: "",
    activeType: ALL_CATEGORIES,
    statusFilter: null,
    company: null,
    sort: "code",
    draftOnly: false,
    setQuery: vi.fn(),
    setActiveType: vi.fn(),
    setStatusFilter: vi.fn(),
    setCompany: vi.fn(),
    setDraftOnly: vi.fn(),
    setSort: vi.fn(),
    reset: vi.fn(),
    isFiltered: false,
    ...overrides,
  };
}

afterEach(cleanup);

describe("SpecDraftsToggle", () => {
  it("показывает число черновиков и включает фильтр одним нажатием", async () => {
    const user = userEvent.setup();
    const f = filters();

    render(
      <SpecDraftsToggle
        filters={f}
        items={[
          item({ id: "a", status: "draft" }),
          item({ id: "b", status: "draft" }),
          item({ id: "c", status: "picked" }),
        ]}
      />,
    );

    const chip = screen.getByRole("button", { name: /Черновики/ });
    expect(chip.textContent).toContain("2");
    expect(chip.getAttribute("aria-pressed")).toBe("false");

    await user.click(chip);

    expect(f.setDraftOnly).toHaveBeenCalledWith(true);
  });

  it("выключенный фильтр без черновиков не показывается: обещать нечего", () => {
    render(
      <SpecDraftsToggle
        filters={filters()}
        items={[item({ status: "picked" })]}
      />,
    );

    expect(screen.queryByRole("button", { name: /Черновики/ })).toBeNull();
  });

  it("включённый фильтр остаётся на месте, даже когда черновиков не осталось", async () => {
    const user = userEvent.setup();
    const f = filters({ statusFilter: "draft", draftOnly: true });

    render(<SpecDraftsToggle filters={f} items={[item({ status: "picked" })]} />);

    const chip = screen.getByRole("button", { name: /Черновики/ });
    expect(chip.getAttribute("aria-pressed")).toBe("true");

    // Снятие фильтра обязано быть доступным и на пустом списке: иначе
    // пользователь остаётся с пустой спецификацией и без кнопки.
    await user.click(chip);
    expect(f.setDraftOnly).toHaveBeenCalledWith(false);
  });
});

describe("SpecSupplierSelect", () => {
  it("показывает «Все поставщики», пока фильтр не выбран", () => {
    render(
      <SpecSupplierSelect
        filters={filters()}
        items={[item({ companyName: "Ромашка" })]}
      />,
    );

    expect(screen.getByRole("combobox", { name: "Поставщик" }).textContent).toContain(
      "Все поставщики",
    );
  });

  it("поставщик из URL виден в триггере, даже если его позиций уже нет", () => {
    // Иначе фильтр не отображается и его нечем снять — то же правило, что у
    // производителя в библиотеке материалов.
    render(
      <SpecSupplierSelect
        filters={filters({ company: "Ромашка" })}
        items={[item({ companyName: "Керама" })]}
      />,
    );

    expect(screen.getByRole("combobox", { name: "Поставщик" }).textContent).toContain(
      "Ромашка",
    );
  });

  it("без поставщиков фильтр выключен и объясняет причину, а не молчит", () => {
    render(
      <SpecSupplierSelect
        filters={filters()}
        items={[item({ companyName: "" })]}
      />,
    );

    const trigger = screen.getByRole("combobox", { name: "Поставщик" });
    expect(trigger.textContent).toContain("Поставщики не указаны");
    expect(trigger.hasAttribute("disabled")).toBe(true);
  });
});

describe("SpecStatusSelect", () => {
  it("показывает «Все статусы», пока фильтр не выбран", () => {
    render(<SpecStatusSelect filters={filters()} items={[item()]} />);

    expect(
      screen.getByRole("combobox", { name: "Статус" }).textContent,
    ).toContain("Все статусы");
  });

  it("выбранный статус назван так же, как в списке позиций", () => {
    // «Черновики» в тулбаре — псевдоним этого самого статуса, и в селекте он
    // обязан называться своим словарным именем: два разных имени одного
    // состояния читались бы как два разных фильтра.
    render(
      <SpecStatusSelect
        filters={filters({ statusFilter: "draft", draftOnly: true })}
        items={[item({ status: "draft" })]}
      />,
    );

    expect(
      screen.getByRole("combobox", { name: "Статус" }).textContent,
    ).toContain("Не выбрано");
  });
});
