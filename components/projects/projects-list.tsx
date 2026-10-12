import { Archive, HousePlus } from "lucide-react";
import { ProjectCard } from "@/components/project/project-card";
import type { ProjectListItem } from "@/lib/queries";
import type { ProjectsView } from "@/lib/types";
import { cn } from "@/lib/utils";
import { EmptyState } from "../layout/empty-state";
import { CreateProjectDialog } from "../project/create-project-dialog";

/**
 * Сетка проектов: рабочий список или архив.
 *
 * Режим приходит из URL (`view`), а не выводится из самих записей: в архиве
 * пусто — это тоже архив, и пустое состояние должно объяснять, что сюда
 * попадает, а не звать создавать проект.
 */
export function ProjectsList({
  projects,
  orgSlug,
  query,
  view,
  canDeleteForever,
}: {
  projects: ProjectListItem[];
  orgSlug: string;
  query: string;
  view: ProjectsView;
  /** Кому доступно окончательное удаление — считается на сервере по роли. */
  canDeleteForever: boolean;
}) {
  const isArchive = view === "archive";

  if (projects.length === 0) {
    if (query) {
      return (
        <p className="mt-8 text-sm text-fg-muted">
          По запросу «{query}» ничего не найдено
        </p>
      );
    }

    return isArchive ? (
      <EmptyState
        icon={<Archive className="size-6" />}
        title="Архив пуст"
        body="Сюда попадают проекты, убранные из работы. Их можно вернуть или удалить навсегда."
      />
    ) : (
      <EmptyState
        icon={<HousePlus className="size-6" />}
        title="Нет проектов"
        body="Создайте ваш первый дизайн-проект и начните работу над спецификациями."
        action={<CreateProjectDialog orgSlug={orgSlug} />}
      />
    );
  }

  return (
    <>
      {isArchive && (
        <p className="mt-8 text-sm text-fg-muted">
          Проекты, убранные из работы. Их можно вернуть или удалить навсегда.
        </p>
      )}

      <div
        className={cn(
          "grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3",
          isArchive ? "mt-4" : "mt-8",
        )}
      >
        {projects.map((p, i) => (
          <ProjectCard
            key={p.id}
            project={p}
            index={i}
            orgSlug={orgSlug}
            canDeleteForever={canDeleteForever}
          />
        ))}
      </div>
    </>
  );
}
