import { describe, expect, it } from "vitest";

import {
  DEFAULT_PROJECTS_FILTERS,
  parseProjectsFilters,
  updateProjectsSearchParams,
} from "./filters";

/**
 * Режим списка проектов (`view`): рабочие проекты или архив.
 *
 * Проверяется здесь, потому что `view` — не украшение URL, а то, по какому
 * признаку страница выбирает записи (`deleted_at is null` или наоборот).
 * Отдельно закреплено, что режим по умолчанию не попадает в адрес и что смена
 * режима сбрасывает страницу: иначе после перехода в архив пользователь
 * оказался бы на «третьей странице» списка, где записей нет.
 */

describe("parseProjectsFilters · режим списка", () => {
  it("без параметров показывает активные проекты", () => {
    expect(parseProjectsFilters({})).toEqual(DEFAULT_PROJECTS_FILTERS);
    expect(parseProjectsFilters({}).view).toBe("active");
  });

  it("читает архив из адреса", () => {
    expect(parseProjectsFilters({ view: "archive" }).view).toBe("archive");
  });

  it("неизвестный режим трактует как активные", () => {
    expect(parseProjectsFilters({ view: "trash" }).view).toBe("active");
  });
});

describe("updateProjectsSearchParams · режим списка", () => {
  it("архив попадает в адрес, возврат к активным — убирает параметр", () => {
    expect(
      updateProjectsSearchParams(new URLSearchParams(""), { view: "archive" }),
    ).toBe("view=archive");

    expect(
      updateProjectsSearchParams(new URLSearchParams("view=archive"), {
        view: "active",
      }),
    ).toBe("");
  });

  it("смена режима сбрасывает страницу", () => {
    expect(
      updateProjectsSearchParams(new URLSearchParams("page=3"), {
        view: "archive",
      }),
    ).toBe("view=archive");
  });

  it("сортировка в архиве сохраняет режим и сбрасывает страницу", () => {
    expect(
      updateProjectsSearchParams(new URLSearchParams("view=archive&page=2"), {
        sort: "name",
      }),
    ).toBe("view=archive&sort=name");
  });
});
