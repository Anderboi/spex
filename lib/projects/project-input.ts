import type { ProjectInput, ProjectStatus } from "@/lib/validations";

/**
 * Поля проекта, которые редактируются общей формой `ProjectDialog`.
 * По составу совпадают с выборкой `PROJECT_LIST_SELECT` (`lib/queries`),
 * поэтому тип подходит и для проекта со страницы спецификации, и для записи
 * из списка проектов.
 */
export interface EditableProject {
  id: string;
  title: string;
  client_name: string | null;
  accent_color: string | null;
  cover_url: string | null;
  address: string | null;
  budget: number | null;
  status: string;
  type: string | null;
  rooms: string[];
}

/**
 * Запись проекта → значения формы.
 *
 * Незаполненные поля (`null` из базы) превращаются в пустые строки и дефолты
 * схемы: в форме это пустое поле, а не подставленный «null». Модуль один на
 * оба места правки — страницу спецификации и карточку в списке, — чтобы
 * правила подстановки не разъехались.
 */
export function toProjectInput(project: EditableProject): ProjectInput {
  return {
    id: project.id,
    title: project.title,
    client_name: project.client_name ?? "",
    accent_color: project.accent_color ?? "#000000",
    cover_url: project.cover_url ?? null,
    address: project.address ?? "",
    budget: project.budget ?? 0,
    status: (project.status || "draft") as ProjectStatus,
    type: (project.type || "Интерьер") as ProjectInput["type"],
    rooms: project.rooms ?? [],
  };
}
