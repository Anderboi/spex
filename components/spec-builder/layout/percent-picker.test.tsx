import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PercentPicker } from "./percent-picker";

/**
 * Быстрый выбор процента: пресеты и свой процент через «…».
 *
 * Проверяется контракт с блоком «Кол-во и цена»: наружу уезжает только целое
 * число процента, а повторное нажатие на выбранный чип — не «снять выбор»
 * (процента «никакого» не бывает, 0 % и есть «без надбавки»).
 */

const OPTIONS = [0, 5, 10, 15];

function setup(value: number) {
  const onChange = vi.fn();
  render(
    <PercentPicker
      label="Запас"
      value={value}
      options={OPTIONS}
      onChange={onChange}
    />,
  );
  return { onChange, user: userEvent.setup() };
}

afterEach(cleanup);

describe("PercentPicker · пресеты", () => {
  it("отдаёт выбранный процент", async () => {
    const { onChange, user } = setup(0);

    await user.click(screen.getByRole("button", { name: "10%" }));

    expect(onChange).toHaveBeenCalledWith(10);
  });

  it("нажатый пресет отмечен для скринридера", () => {
    setup(10);

    expect(
      screen.getByRole("button", { name: "10%" }).getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      screen.getByRole("button", { name: "5%" }).getAttribute("aria-pressed"),
    ).toBe("false");
  });

  it("повторное нажатие на выбранный чип ничего не меняет", async () => {
    const { onChange, user } = setup(10);

    await user.click(screen.getByRole("button", { name: "10%" }));

    // Base UI сообщает о снятии выбора пустым массивом — это не процент.
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("PercentPicker · свой процент", () => {
  it("показывает своё число на «…» вместо многоточия", () => {
    setup(7);

    expect(
      screen.getByRole("button", { name: "Запас: свой процент" }).textContent,
    ).toBe("7%");
  });

  it("применяет введённый процент", async () => {
    const { onChange, user } = setup(0);

    await user.click(
      screen.getByRole("button", { name: "Запас: свой процент" }),
    );
    const input = screen.getByRole("spinbutton");
    await user.clear(input);
    await user.type(input, "7");
    await user.click(screen.getByRole("button", { name: "Применить" }));

    expect(onChange).toHaveBeenCalledWith(7);
  });

  it("срезает значение выше 100 и округляет до целого", async () => {
    const { onChange, user } = setup(0);

    await user.click(
      screen.getByRole("button", { name: "Запас: свой процент" }),
    );
    const input = screen.getByRole("spinbutton");
    await user.clear(input);
    await user.type(input, "130");
    await user.click(screen.getByRole("button", { name: "Применить" }));

    expect(onChange).toHaveBeenCalledWith(100);
  });

  it("очищенное поле не стирает запас в ноль", async () => {
    const { onChange, user } = setup(10);

    await user.click(
      screen.getByRole("button", { name: "Запас: свой процент" }),
    );
    await user.clear(screen.getByRole("spinbutton"));
    await user.click(screen.getByRole("button", { name: "Применить" }));

    expect(onChange).not.toHaveBeenCalled();
  });
});
