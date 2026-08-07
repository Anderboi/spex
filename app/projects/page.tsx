import { fmtRub, plural } from "@/lib/utils";
import { ProjectCard } from "@/components/project/ProjectCard";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { getProjects } from "@/lib/queries";
import { ProjectFilters } from "@/components/project/ProjectFilters";
import { Suspense } from "react";
import EmptyState from "@/components/project/EmptyState";
import PageHeader from '@/components/layout/PageHeader';
import { CreateProjectDialog } from '@/components/project/CreateProjectDialog';

interface ProjectsPageProps {
  searchParams: Promise<{
    q?: string;
    sort?: "date" | "name" | "budget";
  }>;
}

export default async function ProjectsPage({
  searchParams,
}: ProjectsPageProps) {
  const params = await searchParams;
  const query = params.q?.trim().toLowerCase() ?? "";
  const sortBy = params.sort ?? "date";

  const rawProjects = await getProjects();

  const totalBudget = rawProjects.reduce((s, p) => s + (p.budget || 0), 0);
  const totalItems = rawProjects.reduce((s, p) => s + (p.items || 0), 0);
  const activeCount = rawProjects.filter(
    (p) => p.status === "В работе" || p.status === "active",
  ).length;

  let projects = [...rawProjects];

  if (query) {
    projects = projects.filter((p) =>
      (p.title || p.name || "").toLowerCase().includes(query),
    );
  }

  projects.sort((a, b) => {
    if (sortBy === "date") {
      return (
        new Date(b.updated_at || b.updatedAt || 0).getTime() -
        new Date(a.updated_at || a.updatedAt || 0).getTime()
      );
    }
    if (sortBy === "name") {
      const nameA = a.title || a.name || "";
      const nameB = b.title || b.name || "";
      return nameA.localeCompare(nameB, "ru");
    }
    return (b.budget || 0) - (a.budget || 0);
  });

  return (
    <div className="min-h-screen bg-bg text-fg px-[clamp(16px,4vw,48px)] pb-35">
      <div className="max-w-295 mx-auto">
        {/* Header */}
        <div className="flex items-end justify-between gap-5 flex-wrap pt-[clamp(28px,5vw,48px)]">
          <div className="w-full">
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem>
                  <BreadcrumbLink render={<a href="/" />}>Home</BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  <BreadcrumbPage>Проекты</BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
            <div className="flex items-center justify-between gap-3 w-full">
              <div>
                <PageHeader>Проекты</PageHeader>
                <p className="text-[15px] text-fg-secondary mt-2 font-normal">
                  Ваши дизайн-проекты и спецификации
                </p>
              </div>
            </div>
          </div>

          {/* Stats pills */}
          <div className="flex items-center gap-3 flex-wrap w-full">
            <div className="flex items-center gap-2 bg-bg-card border border-border-muted rounded-[11px] py-2.5 px-4">
              <span className="size-2 rounded-full bg-bg-green flex-none" />
              <span className="font-mono text-[13px] font-semibold text-fg">
                {activeCount}
              </span>
              <span className="text-[13px] text-fg-muted">
                {plural(activeCount, "активный", "активных", "активных")}
              </span>
            </div>
            <div className="flex items-center gap-2 bg-bg-card border border-border-muted rounded-[11px] py-2.5 px-4">
              <span className="font-mono text-[13px] font-semibold text-fg">
                {totalItems}
              </span>
              <span className="text-[13px] text-fg-muted">
                {plural(totalItems, "позиция", "позиции", "позиций")}
              </span>
            </div>
            <div className="flex items-center gap-2 bg-bg-card border border-border-muted rounded-[11px] py-2.5 px-4">
              <span className="font-mono text-[13px] font-semibold text-fg">
                {fmtRub(totalBudget)}
              </span>
              <span className="text-[13px] text-fg-muted">общий бюджет</span>
            </div>
            <div className="ml-auto">
              <CreateProjectDialog />
            </div>
            {/* <button className="flex items-center gap-2 bg-bg-accent text-bg border-none rounded-[13px] py-4 px-6 font-sans text-[15px] font-semibold cursor-pointer ml-auto">
              <span className="text-[18px] leading-none -mt-[2px]">+</span>{" "}
              Новый проект
            </button> */}
          </div>
        </div>

        {/* Search & Sort */}
        <Suspense fallback={<div className="h-14 mt-9" />}>
          <ProjectFilters />
        </Suspense>

        {/* Grid or empty */}
        {projects.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5 mt-8">
            {projects.map((p, i) => (
              <ProjectCard key={p.id} project={p} index={i} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
