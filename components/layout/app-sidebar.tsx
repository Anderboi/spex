"use client";

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import { BookUser, Folder, Layers, Settings } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { UserProfile } from "./user-profile";
import { OrgSwitcher, UserOrgItem } from "../orgs/org-switcher";
import { can, OrgRole } from "@/lib/permissions";
import { Separator } from "../ui/separator";

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
       
        <OrgSwitcher currentSlug={currentSlug} organizations={organizations} />
      </SidebarHeader>
      <Separator className="border-border-muted" />
      <SidebarContent className="justify-between">
        <SidebarGroup>
          <SidebarMenu className="gap-1">
            {NAV.map(({ seg, label, icon: Icon }) => {
              const href = `/${currentSlug}/${seg}`;
              const active =
                pathname === href || pathname.startsWith(`${href}/`);

              return (
                <SidebarMenuItem key={seg}>
                  <SidebarMenuButton
                    size={"default"}
                    tooltip={label}
                    className={cn(
                      "cursor-pointer hover:bg-bg-card/60 h-10 px-4 text-fg-secondary/80 hover:text-fg-body ",
                      active &&
                        "bg-bg-card text-fg border border-border hover:bg-bg-select",
                    )}
                    render={
                      <Link
                        href={href}
                        aria-current={active ? "page" : undefined}
                        className="flex gap-4 w-full font-medium items-center"
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

        <SidebarGroup>
          <SidebarMenu>
            <SidebarMenuItem>
              {can(currentRole, "member:invite") && (
                <SidebarMenuButton
                  className="cursor-pointer hover:bg-bg-card/60 h-10 px-4 text-fg-secondary/80 hover:text-fg-body"
                  size={"default"}
                  render={
                    <Link
                      href={`/${currentSlug}/settings/team`}
                      className="flex gap-4 w-full font-medium items-center"
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
              ></SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      <SidebarSeparator />
    </Sidebar>
  );
}
