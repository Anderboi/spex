import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth/session";
import { CreateOrgForm } from '@/components/auth/create-org-form';

export const metadata = { title: "Создание организации" };

export default async function CreateOrgPage() {
  const ctx = await requireAuth();
  if (ctx.orgId) redirect("/projects"); // организация уже есть

  return (
    <div className="flex min-h-svh items-center justify-center bg-muted/30 p-4">
      <CreateOrgForm
        defaultName={ctx.user.name ? `Студия ${ctx.user.name}` : ""}
      />
    </div>
  );
}
