import { getProjects } from "@/lib/queries";
import { CreateProjectDialog } from "@/components/project/create-project-dialog";
import { PageHeader } from "@/components/layout/page-header";
import { Suspense } from "react";
import { parseProjectsFilters } from "@/lib/projects/filters";
import { ProjectsToolbar } from "@/components/projects/projects-toolbar";
import { ProjectsList } from "@/components/projects/projects-list";
import { ProjectsPagination } from "@/components/projects/projects-pagination";
import { ProjectsSkeleton } from "@/components/projects/projects-skeleton";
import { requireOrgBySlug } from "@/lib/auth/session";
import { can } from "@/lib/permissions";

export const metadata = { title: "Проекты" };

type Props = {
  params: Promise<{ orgSlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ProjectsPage({ params, searchParams }: Props) {
  const { orgSlug } = await params;

  return (
    <>
      {/* Header */}
      <PageHeader title="Проекты">
        <CreateProjectDialog orgSlug={orgSlug} />
      </PageHeader>

      <div className="mt-5">
        <ProjectsToolbar />
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

  const [{ items, pageCount }, ctx] = await Promise.all([
    getProjects(orgSlug, filters),
    // Роль нужна карточкам архива: окончательное удаление — только владелец и
    // администратор, и кнопка, которая заведомо не сработает, не показывается.
    requireOrgBySlug(orgSlug),
  ]);

  return (
    <section className="mt-4">
      <ProjectsList
        projects={items}
        orgSlug={orgSlug}
        query={filters.query}
        view={filters.view}
        canDeleteForever={can(ctx.role, "record:mutate:any")}
      />
      <ProjectsPagination page={filters.page} pageCount={pageCount} />
    </section>
  );
}
