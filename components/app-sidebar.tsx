"use client";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarSeparator,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import { BookUser, Folder, Layers, Settings } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { UserProfile } from "./layout/user-profile";
import { OrgSwitcher, UserOrgItem } from "./orgs/org-switcher";
import { can, OrgRole } from "@/lib/permissions";

const NAV = [
  { seg: "projects", label: "Проекты", icon: Folder },
  { seg: "materials", label: "Материалы", icon: Layers },
  { seg: "contacts", label: "Контакты", icon: BookUser },
] as const;

export type AppSidebarProps = {
  user: { name: string | null; email: string | null; image: string | null };
  currentOrgId: string;
  currentSlug: string;
  currentRole: OrgRole;
  organizations: UserOrgItem[];
};

export function AppSidebar({
  user,
  currentSlug,
  currentRole,
  organizations,
}: AppSidebarProps) {
  const pathname = usePathname();

  return (
    <Sidebar variant="sidebar" collapsible="icon">
      <SidebarHeader className="font-heading text-xl flex flex-row items-center justify-between">
        {/* <span className="group-data-[collapsible=icon]:hidden truncate font-semibold">
          Spex
        </span> */}
        <OrgSwitcher currentSlug={currentSlug} organizations={organizations} />
        {/* <SidebarTrigger /> */}
      </SidebarHeader>
      {/* <SidebarSeparator className='w-full'/> */}
      <SidebarContent>
        <SidebarGroup>
          <SidebarMenu className="gap-1">
            {NAV.map(({ seg, label, icon: Icon }) => {
              const href = `/${currentSlug}/${seg}`;
              const active =
                pathname === href || pathname.startsWith(`${href}/`);
              // const Icon = item.icon;
              return (
                <SidebarMenuItem key={seg}>
                  <SidebarMenuButton
                    size={"default"}
                    tooltip={label}
                    className={cn(
                      "cursor-pointer hover:bg-bg-brand/50 h-10 px-4 text-fg-secondary/80 hover:text-fg-body ",
                      active && "bg-bg-brand text-fg hover:bg-bg-select",
                    )}
                    render={
                      <Link
                        href={href}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          "flex gap-2 w-full font-medium items-center //text-fg-secondary",
                        )}
                      />
                    }
                  >
                    <Icon className="size-4 shrink-0" />
                    {label}
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      <SidebarSeparator />
      <SidebarFooter>
        <SidebarGroup>
          <SidebarMenu>
            <SidebarMenuItem>
              {can(currentRole, "member:invite") && (
                <SidebarMenuButton
                  render={
                    <Link
                      href={`/${currentSlug}/settings/team`}
                      className="flex h-10 items-center gap-2 rounded-md px-3 text-sm text-fg-secondary hover:bg-bg-card/60"
                    />
                  }
                >
                  <Settings className="size-4 shrink-0" />
                  Команда
                </SidebarMenuButton>
              )}
            </SidebarMenuItem>

            <SidebarMenuItem>
              <SidebarMenuButton
                render={<UserProfile orgSlug={currentSlug} user={user} />}
              >
                {/* <SidebarMenuBadge>24</SidebarMenuBadge> */}
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>
        {/* <div className="group-data-[collapsible=icon]:hidden"> */}
        {/* {can(currentRole, "member:invite") && (
            <Link
              href={`/${currentSlug}/settings/team`}
              className="flex h-10 items-center gap-2 rounded-md px-3 text-sm text-fg-secondary hover:bg-bg-card/60"
            >
              <Settings className="size-4 shrink-0" />
              Команда
            </Link>
          )} */}
        {/* <OrgSwitcher currentSlug={currentSlug} organizations={organizations} /> */}
        {/* <Link
            href={`/${session.org.slug}/projects`}
            onClick={() => void switchOrganization(session.org.id)}
          >
            {session.org.name}
          </Link> */}
        {/* </div> */}
        {/* <UserProfile user={user} /> */}
      </SidebarFooter>
    </Sidebar>
  );
}
