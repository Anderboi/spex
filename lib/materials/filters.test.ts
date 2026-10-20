import { describe, expect, it } from "vitest";

import {
  DEFAULT_MATERIALS_FILTERS,
  hasMaterialsFilters,
  isMaterialsFavoriteOnly,
  parseMaterialsFilters,
  parseMaterialsFiltersFromSearchParams,
  updateMaterialsSearchParams,
} from "./filters";

/**
 * Фильтр по компании (`company`) — адрес, по которому библиотека открывается из
 * карточки компании («Перейти к материалам компании»).
 *
 * Проверяется здесь, потому что значение параметра — не украшение URL, а то, по
 * какому признаку страница выбирает материалы (компания из списка поставщиков
 * материала, `materials.supplier_company_ids`; «основной» — только первая из
 * них). Отдельно закреплено, что смена компании сбрасывает страницу: иначе после
 * перехода со второй страницы списка пользователь оказался бы на «второй
 * странице» чужой выборки, где записей нет.
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

describe("parseMaterialsFilters · избранное", () => {
  it("по умолчанию фильтр выключен", () => {
    expect(parseMaterialsFilters({}).favorite).toBe(false);
    expect(parseMaterialsFilters({})).toEqual(DEFAULT_MATERIALS_FILTERS);
  });

  it("читает включённый фильтр из адреса", () => {
    expect(parseMaterialsFilters({ favorite: "1" }).favorite).toBe(true);
  });

  it("неизвестное значение фильтр не включает", () => {
    expect(parseMaterialsFilters({ favorite: "0" }).favorite).toBe(false);
    expect(parseMaterialsFilters({ favorite: "true" }).favorite).toBe(false);
  });

  it("в режиме «Архив» фильтр не включается", () => {
    expect(
      parseMaterialsFilters({ status: "archived", favorite: "1" }).favorite,
    ).toBe(false);
  });

  it("один в избранном — единственный активный фильтр", () => {
    const onlyFavorite = parseMaterialsFilters({ favorite: "1" });

    expect(isMaterialsFavoriteOnly(onlyFavorite)).toBe(true);
    expect(hasMaterialsFilters(onlyFavorite)).toBe(true);

    expect(
      isMaterialsFavoriteOnly(
        parseMaterialsFilters({ favorite: "1", query: "плитка" }),
      ),
    ).toBe(false);
    expect(hasMaterialsFilters(parseMaterialsFilters({}))).toBe(false);
  });

  it("из строки запроса читается по тем же правилам", () => {
    expect(
      parseMaterialsFiltersFromSearchParams(
        new URLSearchParams("favorite=1&page=2"),
      ),
    ).toEqual({
      ...DEFAULT_MATERIALS_FILTERS,
      favorite: true,
      page: 2,
    });

    // Дубль параметра: сервер берёт первое значение — клиент тоже.
    expect(
      parseMaterialsFiltersFromSearchParams(
        new URLSearchParams("favorite=0&favorite=1"),
      ).favorite,
    ).toBe(false);
  });
});

describe("updateMaterialsSearchParams · избранное", () => {
  it("включение пишет параметр, выключение — убирает", () => {
    expect(
      updateMaterialsSearchParams(new URLSearchParams(""), { favorite: true }),
    ).toBe("favorite=1");

    expect(
      updateMaterialsSearchParams(new URLSearchParams("favorite=1"), {
        favorite: false,
      }),
    ).toBe("");
  });

  it("смена избранного сбрасывает страницу", () => {
    expect(
      updateMaterialsSearchParams(new URLSearchParams("page=3"), {
        favorite: true,
      }),
    ).toBe("favorite=1");
  });

  it("избранное сочетается с остальными фильтрами и не затирает их", () => {
    expect(
      updateMaterialsSearchParams(new URLSearchParams("query=плитка"), {
        favorite: true,
      }),
    ).toBe("query=%D0%BF%D0%BB%D0%B8%D1%82%D0%BA%D0%B0&favorite=1");

    expect(
      updateMaterialsSearchParams(new URLSearchParams("favorite=1&page=2"), {
        category: "tiles",
      }),
    ).toBe("favorite=1&category=tiles");
  });

  it("переход в архив снимает избранное из адреса", () => {
    expect(
      updateMaterialsSearchParams(new URLSearchParams("favorite=1&page=2"), {
        status: "archived",
      }),
    ).toBe("status=archived");
  });

  it("избранное не попадает в адрес рядом с архивом", () => {
    expect(
      updateMaterialsSearchParams(new URLSearchParams("status=archived"), {
        favorite: true,
      }),
    ).toBe("status=archived");

    expect(
      updateMaterialsSearchParams(
        new URLSearchParams("status=archived&favorite=1&page=2"),
        { company: "company-1" },
      ),
    ).toBe("status=archived&company=company-1");
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
