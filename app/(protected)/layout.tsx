import { AppSidebar } from "@/components/app-sidebar";
import { SidebarProvider } from "@/components/ui/sidebar";
import { requireSession } from "@/lib/auth";
import { getUserOrganizations } from "@/lib/queries";

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await requireSession();
  const organizations = await getUserOrganizations();

  return (
    <>
      <SidebarProvider>
        <AppSidebar
          session={session}
          currentOrgId={session?.orgId}
          organizations={organizations}
        />
        <div className="relative flex min-h-svh flex-1 min-w-0 w-full bg-bg overflow-x-hidden">
          <main className="flex-1 w-full min-w-0">{children}</main>
          {process.env.NODE_ENV === "development" && (
            <script
              src="https://unpkg.com/react-scan/dist/auto.global.js"
              async
            />
          )}
        </div>
      </SidebarProvider>
    </>
  );
}
