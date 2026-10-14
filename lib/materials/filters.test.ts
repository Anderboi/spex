import { describe, expect, it } from "vitest";

import {
  DEFAULT_MATERIALS_FILTERS,
  parseMaterialsFilters,
  updateMaterialsSearchParams,
} from "./filters";

/**
 * Фильтр по компании (`company`) — адрес, по которому библиотека открывается из
 * карточки компании («Перейти к материалам компании»).
 *
 * Проверяется здесь, потому что значение параметра — не украшение URL, а то, по
 * какому признаку страница выбирает материалы (`materials.company_id`). Отдельно
 * закреплено, что смена компании сбрасывает страницу: иначе после перехода со
 * второй страницы списка пользователь оказался бы на «второй странице» чужой
 * выборки, где записей нет.
 */

describe("parseMaterialsFilters · компания", () => {
  it("без параметров фильтра по компании нет", () => {
    expect(parseMaterialsFilters({}).company).toBeNull();
    expect(parseMaterialsFilters({})).toEqual(DEFAULT_MATERIALS_FILTERS);
  });

  it("читает компанию из адреса", () => {
    expect(parseMaterialsFilters({ company: "company-1" }).company).toBe(
      "company-1",
    );
  });

  it("берёт первое значение, если параметр пришёл списком", () => {
    expect(
      parseMaterialsFilters({ company: ["company-1", "company-2"] }).company,
    ).toBe("company-1");
  });

  it("слишком длинный идентификатор фильтром не становится", () => {
    expect(parseMaterialsFilters({ company: "c".repeat(65) }).company).toBeNull();
  });
});

describe("updateMaterialsSearchParams · компания", () => {
  it("выбор компании попадает в адрес, снятие — убирает параметр", () => {
    expect(
      updateMaterialsSearchParams(new URLSearchParams(""), {
        company: "company-1",
      }),
    ).toBe("company=company-1");

    expect(
      updateMaterialsSearchParams(new URLSearchParams("company=company-1"), {
        company: null,
      }),
    ).toBe("");
  });

  it("смена компании сбрасывает страницу", () => {
    expect(
      updateMaterialsSearchParams(new URLSearchParams("page=3"), {
        company: "company-1",
      }),
    ).toBe("company=company-1");
  });

  it("снятие компании оставляет остальные фильтры", () => {
    expect(
      updateMaterialsSearchParams(
        new URLSearchParams("company=company-1&category=tiles&page=2"),
        { company: null },
      ),
    ).toBe("category=tiles");
  });

  it("компания и бренд — разные параметры и не затирают друг друга", () => {
    expect(
      updateMaterialsSearchParams(
        new URLSearchParams("manufacturer=Kerama"),
        { company: "company-1" },
      ),
    ).toBe("manufacturer=Kerama&company=company-1");
  });
});
