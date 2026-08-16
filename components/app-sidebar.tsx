"use client";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import { BookUser, Folder, Layers } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { UserProfile } from "./layout/user-profile";
import { OrgSwitcher, UserOrgItem } from './orgs/org-switcher';

const NAV_ITEMS = [
  { href: "/projects", label: "Проекты", icon: Folder },
  { href: "/materials", label: "Материалы", icon: Layers },
  { href: "/contacts", label: "Контакты", icon: BookUser },
];

interface AppSidebarProps {
  session?: any;
  currentOrgId?: string | null;
  organizations?: UserOrgItem[];
}

export function AppSidebar({
  session,
  currentOrgId = null,
  organizations = [],
}: AppSidebarProps) {
  const pathname = usePathname();

  return (
    <Sidebar variant="sidebar" collapsible="icon">
      <SidebarHeader className="font-heading text-xl flex flex-row items-center justify-between">
        <span className="group-data-[collapsible=icon]:hidden truncate font-semibold">
          Spex
        </span>
        <SidebarTrigger />
      </SidebarHeader>
      <SidebarSeparator />
      <SidebarContent>
        <SidebarGroup>
          <SidebarMenu className="gap-1">
            {NAV_ITEMS.map((item, index) => {
              const isActive = pathname === item.href;
              const Icon = item.icon;
              return (
                <SidebarMenuItem key={index}>
                  <SidebarMenuButton
                    size={"default"}
                    tooltip={item.label}
                    className={cn(
                      "cursor-pointer hover:bg-bg-brand/50 h-10 px-4 text-fg-secondary/80 hover:text-fg-body ",
                      isActive && "bg-bg-brand text-fg hover:bg-bg-select",
                    )}
                  >
                    <Link
                      href={item.href}
                      className={cn(
                        "flex gap-2 w-full font-medium items-center //text-fg-secondary",
                      )}
                    >
                      <Icon className="shrink-0" />
                      {item.label}
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      <SidebarSeparator />
      <SidebarFooter>
        <div className="group-data-[collapsible=icon]:hidden">
          <OrgSwitcher
            currentOrgId={currentOrgId ?? session?.user?.org_id ?? null}
            organizations={organizations}
          />
        </div>
        <UserProfile user={session?.user} />
      </SidebarFooter>
    </Sidebar>
  );
}
