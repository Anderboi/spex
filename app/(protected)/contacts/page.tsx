import { redirect } from "next/navigation";
import { requireOrg } from "@/lib/auth/session";

export default async function Bridge() {
  const { orgSlug } = await requireOrg();
  redirect(`/${orgSlug}/contacts`);
}
