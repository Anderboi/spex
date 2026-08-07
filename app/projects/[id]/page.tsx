import SpecBuilder from "@/components/spec-builder/SpecBuilder";
import { getProjectById, getProjectSpecItems } from "@/lib/queries";
import { notFound } from "next/navigation";

interface ProjectPageProps {
  params: Promise<{ id: string }>;
}

export default async function ProjectSpecification({
  params,
}: ProjectPageProps) {
  const { id } = await params;

  const [project, specItems] = await Promise.all([
    getProjectById(id),
    getProjectSpecItems(id),
  ]);

  if (!project) {
    notFound();
  }

  return <SpecBuilder projectId={id} initialItems={specItems} />;
}
