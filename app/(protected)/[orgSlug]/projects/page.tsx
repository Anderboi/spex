import { fmtRub, plural } from "@/lib/utils";
import { ProjectCard } from "@/components/project/project-card";
import { getProjects, getProjectsStats, ProjectSort } from "@/lib/queries";
import EmptyState from "@/components/project/empty-state";
import { CreateProjectDialog } from "@/components/project/create-project-dialog";
import { SearchSortBar } from "@/components/layout/search-sort-bar";
import { Suspense } from "react";
import { PageHeader } from "@/components/layout/page-header";

export const metadata = { title: "Проекты" };

interface ProjectsPageProps {
  params: Promise<{ orgSlug: string }>;
  searchParams: Promise<{ q?: string; sort?: ProjectSort }>;
}

export default async function ProjectsPage({
  params,
  searchParams,
}: ProjectsPageProps) {
  const [{ orgSlug }, sp] = await Promise.all([params, searchParams]);
  const stats = await getProjectsStats(orgSlug);

  return (
    <>
      {/* Header */}
      <PageHeader title="Проекты">
        <CreateProjectDialog orgSlug={orgSlug} />
      </PageHeader>

      {/* Search & Sort */}
      <div className="flex items-center gap-2 flex-wrap">
        <SearchSortBar
          className="flex-1"
          placeholder="Поиск проекта по адресу, клиенту, названию..."
        />
        <div className="flex items-center gap-2 bg-bg-card border border-border-muted h-10 rounded-lg px-4">
          <span className="size-2 rounded-full bg-bg-green flex-none" />
          <span className="font-mono text-[13px] font-semibold text-fg">
            {stats.active}
          </span>
          <span className="text-[13px] text-fg-muted">
            {plural(stats.active, "активный", "активных", "активных")}
          </span>
        </div>
        <div className="flex items-center gap-2 h-10 bg-bg-card border border-border-muted rounded-lg px-4">
          <span className="font-mono text-[13px] font-semibold text-fg">
            {stats.total}
          </span>
          <span className="text-[13px] text-fg-muted">
            {plural(stats.total, "позиция", "позиции", "позиций")}
          </span>
        </div>
        <div className="flex items-center gap-2 bg-bg-card border border-border-muted rounded-lg h-10 px-4">
          <span className="font-mono text-[13px] font-semibold text-fg">
            {fmtRub(stats.budget)}
          </span>
          <span className="text-[13px] text-fg-muted">общий бюджет</span>
        </div>
      </div>

      <Suspense key={`${sp.q}-${sp.sort}`} fallback={<ProjectsGridSkeleton />}>
        <ProjectsGrid orgSlug={orgSlug} search={sp.q} sort={sp.sort} />
      </Suspense>
    </>
  );
}

async function ProjectsGrid({
  orgSlug,
  search,
  sort,
}: {
  orgSlug: string;
  search?: string;
  sort?: ProjectSort;
}) {
  const projects = await getProjects({ orgSlug, search, sort });

  if (projects.length === 0) {
    return search ? (
      <p className="mt-8 text-sm text-fg-muted">
        По запросу «{search}» ничего не найдено
      </p>
    ) : (
      <EmptyState />
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

function ProjectsGridSkeleton() {
  return (
    <div className="mt-8 grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="h-56 animate-pulse rounded-xl bg-bg-card" />
      ))}
    </div>
  );
}
