import { fmtRub, plural } from "@/lib/utils";
import { getProjects, getProjectsStats } from "@/lib/queries";
import { CreateProjectDialog } from "@/components/project/create-project-dialog";
import { PageHeader } from "@/components/layout/page-header";
import { Suspense } from "react";
import { parseProjectsFilters } from "@/lib/projects/filters";
import { ProjectsToolbar } from "@/components/projects/projects-toolbar";
import { ProjectsList } from "@/components/projects/projects-list";
import { ProjectsPagination } from "@/components/projects/projects-pagination";
import { ProjectsSkeleton } from "@/components/projects/projects-skeleton";

export const metadata = { title: "Проекты" };

type Props = {
  params: Promise<{ orgSlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ProjectsPage({ params, searchParams }: Props) {
  const { orgSlug } = await params;
  const stats = await getProjectsStats(orgSlug);

  return (
    <>
      {/* Header */}
      <PageHeader title="Проекты">
        <CreateProjectDialog orgSlug={orgSlug} />
      </PageHeader>

      <div className="mt-5">
        <ProjectsToolbar />
      </div>

      <div className="mt-3 flex items-center gap-2 flex-wrap">
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

      <Suspense fallback={<ProjectsSkeleton />}>
        <ProjectsData orgSlug={orgSlug} searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function ProjectsData({
  orgSlug,
  searchParams,
}: {
  orgSlug: string;
  searchParams: Props["searchParams"];
}) {
  const sp = await searchParams;
  const filters = parseProjectsFilters(sp);

  const { items, pageCount } = await getProjects(orgSlug, filters);

  return (
    <>
      <ProjectsList projects={items} orgSlug={orgSlug} query={filters.query} />
      <ProjectsPagination page={filters.page} pageCount={pageCount} />
    </>
  );
}
