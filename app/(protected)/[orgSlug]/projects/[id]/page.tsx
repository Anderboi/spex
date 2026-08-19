import SpecBuilder from "@/components/spec-builder/SpecBuilder";
import { getProjectById, getProjectSpecItems } from "@/lib/queries";
import { notFound } from "next/navigation";

interface ProjectPageProps {
  params: Promise<{ orgSlug: string; id: string }>;
}

export default async function ProjectSpecification({
  params,
}: ProjectPageProps) {
  const { id, orgSlug } = await params;

  const [project, specItems] = await Promise.all([
    getProjectById(orgSlug, id),
    getProjectSpecItems(orgSlug, id),
  ]);

  if (!project) {
    notFound();
  }

  return <SpecBuilder orgSlug={orgSlug} projectId={id} project={project} initialItems={specItems}  />;
}
