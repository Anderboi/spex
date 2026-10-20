import { describe, expect, it } from "vitest";
import { hasFavoriteMark } from "./favorites";

/**
 * Признак «отмечен мной» в строке библиотеки.
 *
 * Строка приходит из PostgREST с вложенной выборкой `material_favorites
 * (user_id)`. Наблюдаемое поведение: отмечен ли материал именно этим
 * пользователем — и ничего о том, какими запросами это получено.
 */
describe("hasFavoriteMark · «отмечен мной»", () => {
  const me = "user-me";
  const colleague = "user-colleague";

  it("вложенной выборки нет — материал не отмечен", () => {
    expect(hasFavoriteMark(undefined, me)).toBe(false);
    expect(hasFavoriteMark(null, me)).toBe(false);
  });

  it("вложенная выборка пуста — материал не отмечен", () => {
    expect(hasFavoriteMark([], me)).toBe(false);
  });

  it("в строке моя отметка — материал отмечен", () => {
    expect(hasFavoriteMark([{ user_id: me }], me)).toBe(true);
  });

  it("в строке моя и чужая отметки — материал отмечен", () => {
    expect(
      hasFavoriteMark([{ user_id: colleague }, { user_id: me }], me),
    ).toBe(true);
  });

  it("в строке только чужая отметка — материал не отмечен", () => {
    expect(hasFavoriteMark([{ user_id: colleague }], me)).toBe(false);
  });

  it("вложение пришло объектом, а не массивом", () => {
    expect(hasFavoriteMark({ user_id: me }, me)).toBe(true);
    expect(hasFavoriteMark({ user_id: colleague }, me)).toBe(false);
  });
});
