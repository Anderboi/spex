import SpecBuilder from "@/components/spec-builder/spec-builder";
import { EditProjectDialog } from "@/components/project/edit-project-dialog";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Edit, Plus } from "lucide-react";
import {
  getMaterials,
  getProjectById,
  getProjectSpecItems,
  getSpecPickerData,
} from "@/lib/queries";
import { withSearchParams } from "@/lib/query-string";
import Link from "next/link";
import { notFound } from "next/navigation";

interface ProjectPageProps {
  params: Promise<{ orgSlug: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function ProjectSpecification({
  params,
  searchParams,
}: ProjectPageProps) {
  const { id, orgSlug } = await params;
  const sp = await searchParams;

  const [project, specItems, picker, library] = await Promise.all([
    getProjectById(orgSlug, id),
    getProjectSpecItems(orgSlug, id),
    getSpecPickerData(orgSlug),
    getMaterials(orgSlug),
  ]);

  if (!project) notFound();

  // Открытие диалогов — через URL (?dialog=...), существующие search params
  // при этом сохраняются. Сами модалки рендерит SpecBuilder.
  const base = `/${orgSlug}/projects/${id}`;
  const editHref = withSearchParams(base, sp, { action: "edit", dialog: null });
  const addHref = withSearchParams(base, sp, { dialog: "add" });
  const procureHref = withSearchParams(base, sp, { dialog: "procure" });
  const summaryHref = withSearchParams(base, sp, { dialog: "summary" });

  return (
    <>
      <PageHeader
        title={project.title}
        editButton={
          <Button
            nativeButton={false}
            variant="ghost"
            className="text-fg-muted"
            render={
              <Link
                href={editHref}
                aria-label="Редактировать данные проекта"
                title="Редактировать данные проекта"
              />
            }
          >
            <Edit className="size-4" />
          </Button>
        }
      >
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button
            nativeButton={false}
            render={<Link href={addHref} />}
            className="flex h-10 items-center gap-1.5 rounded-lg bg-bg-accent px-4 text-[13.5px] font-semibold text-bg"
          >
            <Plus className="size-4" /> Добавить
          </Button>
          <Button
            nativeButton={false}
            variant="outline"
            render={<Link href={procureHref} />}
            className="flex h-10 items-center gap-1.5 rounded-lg border border-border-muted bg-bg-card px-3 text-[13.5px] font-semibold text-fg hover:border-fg"
          >
            Закупка
          </Button>
          <Button
            nativeButton={false}
            variant="outline"
            render={<Link href={summaryHref} />}
            className="flex h-10 items-center gap-1.5 rounded-lg border border-border-muted bg-bg-card px-3 text-[13.5px] font-semibold text-fg hover:border-fg"
          >
            Сводка
          </Button>
        </div>
      </PageHeader>
      <EditProjectDialog orgSlug={orgSlug} project={project} />
      <SpecBuilder
        orgSlug={orgSlug}
        projectId={id}
        project={project}
        initialItems={specItems}
        companies={picker.companies}
        contacts={picker.contacts}
        library={library}
      />
    </>
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ orgSlug: string; id: string }>;
}) {
  const { orgSlug, id } = await params;
  const project = await getProjectById(orgSlug, id);
  return {
    title: project ? `${project.title} · Спецификация` : "Проект не найден",
  };
}
