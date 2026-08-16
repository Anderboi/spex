import { fmtRub, plural } from "@/lib/utils";
import { ProjectCard } from "@/components/project/project-card";
import { getProjects } from "@/lib/queries";
import EmptyState from "@/components/project/empty-state";
import PageTitle from "@/components/layout/page-title";
import { CreateProjectDialog } from "@/components/project/create-project-dialog";
import { SearchSortBar } from "@/components/layout/search-sort-bar";
import { Suspense } from "react";

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
  // const totalItems = rawProjects.reduce((s, p) => s + (p.items || 0), 0);
  const activeCount = rawProjects.filter(
    (p) => p.status === "В работе" || p.status === "active",
  ).length;

  let projects = [...rawProjects];

  if (query) {
    projects = projects.filter((p) =>
      (p.title || p.address || "").toLowerCase().includes(query),
    );
  }

  projects.sort((a, b) => {
    if (sortBy === "date") {
      return (
        new Date(b.updated_at || b.updated_at || 0).getTime() -
        new Date(a.updated_at || a.updated_at || 0).getTime()
      );
    }
    if (sortBy === "name") {
      const nameA = a.title || a.address || "";
      const nameB = b.title || b.address || "";
      return nameA.localeCompare(nameB, "ru");
    }
    return (b.budget || 0) - (a.budget || 0);
  });

  return (
    <>
      {/* Header */}
      <div className="flex items-end justify-between gap-4 flex-wrap pt-[clamp(28px,5vw,48px)]">
        {/* Title & description */}
        <div>
          <PageTitle>Проекты</PageTitle>
          <p className="text-[15px] text-pretty text-fg-secondary mt-2 font-normal">
            Ваши дизайн-проекты и спецификации
          </p>
        </div>

        {/* Stats pills */}
        <div className="flex items-center gap-3 pb-4 flex-wrap w-full">
          <div className="flex items-center gap-2 bg-bg-card border border-border-muted h-10 rounded-lg px-4">
            <span className="size-2 rounded-full bg-bg-green flex-none" />
            {/* <span className="font-mono text-[13px] font-semibold text-fg">
              {activeCount}
            </span> */}
            {/* <span className="text-[13px] text-fg-muted">
              {plural(activeCount, "активный", "активных", "активных")}
            </span> */}
          </div>
          <div className="flex items-center gap-2 h-10 bg-bg-card border border-border-muted rounded-lg px-4">
            {/* <span className="font-mono text-[13px] font-semibold text-fg">
              {totalItems}
            </span>
            <span className="text-[13px] text-fg-muted">
              {plural(totalItems, "позиция", "позиции", "позиций")}
            </span> */}
          </div>
          <div className="flex items-center gap-2 bg-bg-card border border-border-muted rounded-lg h-10 px-4">
            {/* <span className="font-mono text-[13px] font-semibold text-fg">
              {fmtRub(totalBudget)}
            </span> */}
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
      <SearchSortBar placeholder="Поиск проекта по адресу, клиенту, названию..." />

      <Suspense fallback={<div>Loading...</div>}>
        <ProjectsData />
      </Suspense>
      {/* Grid or empty */}
      {/* {projects.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5 mt-8">
          {projects.map((p, i) => (
            <ProjectCard key={p.id} project={p} index={i} />
          ))}
        </div>
      )} */}
    </>
  );
}

async function ProjectsData() {
  const projects = await getProjects();
  return (
    <>
      {projects.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5 mt-8">
          {projects.map((p, i) => (
            <ProjectCard key={p.id} project={p} index={i} />
          ))}
        </div>
      )}
    </>
  );
}
