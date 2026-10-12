import { ProjectCard } from "@/components/project/project-card";
import type { ProjectListItem } from "@/lib/queries";
import { EmptyState } from "../layout/empty-state";
import { CreateProjectDialog } from "../project/create-project-dialog";
import { HousePlus } from 'lucide-react';

export function ProjectsList({
  projects,
  orgSlug,
  query,
}: {
  projects: ProjectListItem[];
  orgSlug: string;
  query: string;
}) {
  if (projects.length === 0) {
    return query ? (
      <p className="mt-8 text-sm text-fg-muted">
        По запросу «{query}» ничего не найдено
      </p>
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
    <div className="mt-8 grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
      {projects.map((p, i) => (
        <ProjectCard key={p.id} project={p} index={i} orgSlug={orgSlug} />
      ))}
    </div>
  );
}
