import { describe, expect, it } from "vitest";

import { formatContactsCount } from "./utils";

/**
 * Русские формы числа в подписи «N контактов».
 *
 * Проверяется здесь, потому что подпись — производная от двух условий сразу
 * (последняя цифра и исключение 11–14), и ошибка в ней видна прямо на карточке
 * компании: «11 контакт» вместо «11 контактов».
 */

describe("formatContactsCount · русские формы числа", () => {
  it("выбирает форму по последней цифре", () => {
    expect(formatContactsCount(1)).toBe("1 контакт");
    expect(formatContactsCount(2)).toBe("2 контакта");
    expect(formatContactsCount(5)).toBe("5 контактов");
    expect(formatContactsCount(21)).toBe("21 контакт");
    expect(formatContactsCount(22)).toBe("22 контакта");
  });

  it("11–14 требуют третьей формы, вопреки последней цифре", () => {
    for (const count of [11, 12, 13, 14, 111, 1012]) {
      expect(formatContactsCount(count)).toBe(`${count} контактов`);
    }
  });

  it("ноль — третья форма", () => {
    expect(formatContactsCount(0)).toBe("0 контактов");
  });
});
