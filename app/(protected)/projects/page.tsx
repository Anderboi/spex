import { redirect } from "next/navigation";
import { requireOrg } from "@/lib/auth/session";

export default async function LegacyProjectsPage() {
  const { orgSlug } = await requireOrg();
  redirect(`/${orgSlug}/projects`);
}
