import SpecBuilder from "@/components/spec-builder/spec-builder";
import {
  getMaterials,
  getProjectById,
  getProjectSpecItems,
  getSpecPickerData,
} from "@/lib/queries";
import { notFound } from "next/navigation";

interface ProjectPageProps {
  params: Promise<{ orgSlug: string; id: string }>;
}

export default async function ProjectSpecification({
  params,
}: ProjectPageProps) {
  const { id, orgSlug } = await params;

  const [project, specItems, picker, library] = await Promise.all([
    getProjectById(orgSlug, id),
    getProjectSpecItems(orgSlug, id),
    getSpecPickerData(orgSlug),
    getMaterials(orgSlug),
  ]);

  if (!project) notFound();

  return (
    <SpecBuilder
      orgSlug={orgSlug}
      projectId={id}
      project={project}
      initialItems={specItems}
      companies={picker.companies}
      contacts={picker.contacts}
      library={library}
    />
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
