import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useVariantSwitch } from "./use-variant-switch";
import type { SpecStatus } from "@/lib/constants";

/**
 * Предупреждение о снятии согласования при смене варианта материала (ADR 0008).
 *
 * Проверяется ровно поведение гейта, а не разметка поверхностей: три места
 * показывают смену варианта по-своему (пилюля в строке, шторка в карточке,
 * строки секции «Варианты»), но вопрос задаёт один и тот же код. Отсюда и
 * стенд: кнопка вместо пилюли — важно, что делается ДО вызова `onSwitch`.
 */

/** Стенд: то, что поверхности делают с решением, — в одном месте. */
function Harness({
  status,
  onSwitch,
}: {
  status: SpecStatus;
  onSwitch: (variantId: string) => void;
}) {
  const { decision, request, dialog } = useVariantSwitch({ status, onSwitch });

  return (
    <div>
      <span data-testid="kind">{decision.kind}</span>
      <button type="button" onClick={() => request("v-b")}>
        Сменить
      </button>
      {dialog}
    </div>
  );
}

function setup(status: SpecStatus) {
  const onSwitch = vi.fn();
  render(<Harness status={status} onSwitch={onSwitch} />);
  return { onSwitch, user: userEvent.setup() };
}

afterEach(cleanup);

describe("useVariantSwitch · согласованная позиция", () => {
  it("смена не проходит молча: сначала вопрос", async () => {
    const { onSwitch, user } = setup("approved");

    await user.click(screen.getByRole("button", { name: "Сменить" }));

    // Вариант ещё не переключён: пользователь видит предупреждение.
    expect(onSwitch).not.toHaveBeenCalled();
    expect(screen.getByText(/Согласование относилось к прежнему материалу/)).toBeTruthy();
    expect(screen.getByText(/«Подобрано»/)).toBeTruthy();
  });

  it("подтверждение переключает выбранный вариант", async () => {
    const { onSwitch, user } = setup("approved");

    await user.click(screen.getByRole("button", { name: "Сменить" }));
    await user.click(screen.getByRole("button", { name: "Сменить вариант" }));

    expect(onSwitch).toHaveBeenCalledWith("v-b");
  });

  it("отмена не переключает ничего", async () => {
    const { onSwitch, user } = setup("approved");

    await user.click(screen.getByRole("button", { name: "Сменить" }));
    await user.click(screen.getByRole("button", { name: "Отмена" }));

    expect(onSwitch).not.toHaveBeenCalled();
  });
});

describe("useVariantSwitch · заказанный и доставленный материал", () => {
  for (const status of ["ordered", "delivered"] as const) {
    it(`«${status}» — смена не проходит вовсе`, async () => {
      const { onSwitch, user } = setup(status);

      await user.click(screen.getByRole("button", { name: "Сменить" }));

      // Ни вопроса, ни вызова: запирать нечего подтверждать.
      expect(screen.getByTestId("kind").textContent).toBe("forbid");
      expect(onSwitch).not.toHaveBeenCalled();
      expect(screen.queryByRole("button", { name: "Сменить вариант" })).toBeNull();
    });
  }
});

describe("useVariantSwitch · остальные статусы", () => {
  for (const status of ["draft", "picked", "replace"] as const) {
    it(`«${status}» — смена без вопросов`, async () => {
      const { onSwitch, user } = setup(status);

      await user.click(screen.getByRole("button", { name: "Сменить" }));

      expect(screen.getByTestId("kind").textContent).toBe("allow");
      expect(onSwitch).toHaveBeenCalledWith("v-b");
    });
  }
});
