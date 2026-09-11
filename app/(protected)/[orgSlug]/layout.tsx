import { AppSidebar } from "@/components/layout/app-sidebar";
import { ConfirmProvider } from "@/components/confirm-provider";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { requireOrgBySlug } from "@/lib/auth/session";

export default async function OrgLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const { user, userId, orgId, role, organizations } =
    await requireOrgBySlug(orgSlug);
  console.log("[createInvite] userId:", userId, "orgId:", orgId);

  return (
    <SidebarProvider>
      <ConfirmProvider>
        <AppSidebar
          user={{
            name: user.name ?? null,
            email: user.email ?? null,
            image: user.image ?? null,
          }}
          currentOrgId={orgId}
          currentSlug={orgSlug}
          currentRole={role}
          organizations={organizations}
        />
        <SidebarInset className="relative flex min-h-svh w-full min-w-0 flex-1 overflow-x-hidden bg-bg">
          {/* <div className="relative flex min-h-svh w-full min-w-0 flex-1 overflow-x-hidden bg-bg"> */}
          {/* <header className="flex h-16 shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
            <SidebarTrigger className="p-4" />
          </header> */}
          <main className="w-full min-w-0 flex-1">{children}</main>
          {/* </div> */}
        </SidebarInset>
      </ConfirmProvider>
    </SidebarProvider>
  );
}
