import { describe, expect, it } from "vitest";

import { toProjectInput, type EditableProject } from "./project-input";

/**
 * Приведение записи проекта к значениям формы `ProjectDialog`.
 *
 * Проверяется отдельно от разметки, потому что именно здесь решается, чем
 * закончится открытие модалки правки на незаполненном проекте: `null` из базы
 * должен стать пустым полем, а не строкой «null», иначе сохранение без правок
 * затирало бы пустые данные.
 */

const project: EditableProject = {
  id: "2f1c0b7a-0000-4000-8000-000000000001",
  title: "Апартаменты в ЖК Prime",
  client_name: null,
  accent_color: null,
  cover_url: null,
  address: null,
  budget: null,
  status: "active",
  type: null,
  rooms: [],
};

describe("toProjectInput", () => {
  it("незаполненные поля отдаёт дефолтами формы", () => {
    expect(toProjectInput(project)).toEqual({
      id: project.id,
      title: "Апартаменты в ЖК Prime",
      client_name: "",
      accent_color: "#000000",
      cover_url: null,
      address: "",
      budget: 0,
      status: "active",
      type: "Интерьер",
      rooms: [],
    });
  });

  it("заполненные поля переносит как есть", () => {
    expect(
      toProjectInput({
        ...project,
        client_name: "Иванов И.",
        accent_color: "#2563EB",
        cover_url: "https://example.com/cover.jpg",
        address: "Москва, Пресненская наб., 12",
        budget: 12_500_000,
        status: "draft",
        type: "Экстерьер",
        rooms: ["Кухня", "Спальня"],
      }),
    ).toEqual({
      id: project.id,
      title: "Апартаменты в ЖК Prime",
      client_name: "Иванов И.",
      accent_color: "#2563EB",
      cover_url: "https://example.com/cover.jpg",
      address: "Москва, Пресненская наб., 12",
      budget: 12_500_000,
      status: "draft",
      type: "Экстерьер",
      rooms: ["Кухня", "Спальня"],
    });
  });
});
