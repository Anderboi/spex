import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { VariantSwitcher } from "./variant-switcher";
import { specItem } from "@/tests/factories/spec-item";
import type { SpecStatus } from "@/lib/constants";
import type { SpecVariant } from "@/lib/types";

/**
 * Пилюля вариантов в строке таблицы спецификации (ADR 0008).
 *
 * Правило живёт в `lib/spec/status.ts` и покрыто там; здесь проверяется его
 * исполнение на поверхности, с которой пользователь и начинает: согласованную
 * позицию смена варианта спрашивает, заказанную — не предлагает вовсе.
 */

function variant(id: string, name: string, isActive: boolean): SpecVariant {
  return {
    id,
    specItemId: "item-1",
    name,
    brand: "",
    article: "",
    spec: "",
    price: 1000,
    productUrl: "",
    imageUrl: null,
    leadTime: "",
    companyId: null,
    contactId: null,
    companyName: "",
    label: isActive ? "Основной" : name,
    isActive,
    position: isActive ? 0 : 1,
  };
}

function setup(status: SpecStatus) {
  const onSwitch = vi.fn();
  render(
    <VariantSwitcher
      item={specItem({
        status,
        variants: [
          variant("v-a", "Керамогранит Blanco", true),
          variant("v-b", "Finex Дуб Роял", false),
        ],
      })}
      onSwitch={onSwitch}
      onAdd={vi.fn()}
      onOpenVariants={vi.fn()}
    />,
  );
  return { onSwitch, user: userEvent.setup() };
}

afterEach(cleanup);

describe("VariantSwitcher · согласованная позиция", () => {
  it("выбор другого варианта спрашивает подтверждение", async () => {
    const { onSwitch, user } = setup("approved");

    await user.click(screen.getByRole("button", { name: "Варианты замены" }));
    // Ищем по роли, а не по тексту: название варианта в строке стоит дважды —
    // подписью и метой (`brand · label`), и поиск по тексту нашёл бы оба.
    await user.click(
      await screen.findByRole("menuitem", { name: /Finex Дуб Роял/ }),
    );

    // Молча материал не меняется: сначала предупреждение о статусе.
    expect(onSwitch).not.toHaveBeenCalled();
    expect(screen.getByText(/«Подобрано»/)).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Сменить вариант" }));
    expect(onSwitch).toHaveBeenCalledWith("v-b");
  });
});

describe("VariantSwitcher · заказанная позиция", () => {
  it("строки выключены, а причина названа словами", async () => {
    const { onSwitch, user } = setup("ordered");

    await user.click(screen.getByRole("button", { name: "Варианты замены" }));

    expect(
      await screen.findByText("Смена варианта недоступна: материал уже заказан."),
    ).toBeTruthy();

    const row = screen.getByRole("menuitem", { name: /Finex Дуб Роял/ });
    expect(row.getAttribute("data-disabled")).not.toBeNull();
    expect(onSwitch).not.toHaveBeenCalled();
  });
});

describe("VariantSwitcher · подобранная позиция", () => {
  it("смена происходит сразу: подтверждать нечего", async () => {
    const { onSwitch, user } = setup("picked");

    await user.click(screen.getByRole("button", { name: "Варианты замены" }));
    await user.click(
      await screen.findByRole("menuitem", { name: /Finex Дуб Роял/ }),
    );

    expect(onSwitch).toHaveBeenCalledWith("v-b");
  });
});
