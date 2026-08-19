"use client";

import { useTransition } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuGroup,
  DropdownMenuShortcut,
} from "@/components/ui/dropdown-menu";
import { Building2, Check, ChevronsUpDown, Loader2, Plus } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { OrgRole, ROLE_LABELS } from "@/lib/permissions";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "../ui/sidebar";

export type UserOrgItem = {
  id: string;
  name: string;
  slug: string;
  role: OrgRole;
};

interface OrgSwitcherProps {
  currentSlug: string;
  organizations: UserOrgItem[];
}
export function OrgSwitcher({
  currentSlug,
  organizations = [],
}: OrgSwitcherProps) {
  const [isPending, startTransition] = useTransition();
  const pathname = usePathname();

  const currentOrg =
    organizations.find((o) => o.slug === currentSlug) ?? organizations[0];

  const section = pathname.split("/").slice(2).join("/") || "projects";

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            disabled={isPending}
            className="w-full bg-bg-card rounded-lg"
            render={
              <SidebarMenuButton
                size="lg"
                aria-label="Переключить организацию"
              />
            }
          >
            {/* //TODO: add company icon */}
            <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-bg-sidebar text-fg-muted gap-2">
              {isPending ? (
                <Loader2 className="size-4 animate-spin text-fg-muted shrink-0" />
              ) : (
                <Building2 className="size-4 shrink-0 text-fg-muted" />
              )}
            </div>
            <span className="grid flex-1 truncate text-left font-sans text-sm leading-tight">
              {currentOrg?.name ?? "Выберите студию"}
            </span>
            <ChevronsUpDown className="ml-auto" />
          </DropdownMenuTrigger>

          <DropdownMenuContent
            align="start"
            className="bg-bg-card w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
            // side={isMobile ? "bottom" : "right"} //TODO: add isMobile
            sideOffset={4}
          >
            <DropdownMenuGroup>
              <DropdownMenuLabel className="text-xs text-fg-muted">
                Компании
              </DropdownMenuLabel>
              {organizations.map((org) => (
                <DropdownMenuItem
                  key={org.id}
                  render={
                    <Link href={`/${org.slug}/${section}`} prefetch={false} />
                  }
                  className="gap-2 p-2 text-xs"
                >
                  <div className="flex size-6 items-center justify-center rounded-md border">
                    <Building2 className="size-3.5 shrink-0 text-fg-muted" />{" "}
                    {/* //TODO: add company icon */}
                  </div>
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate">{org.name}</span>
                    <span className="text-[10px] text-fg-muted">
                      {ROLE_LABELS[org.role]}
                    </span>
                  </span>
                  {org.slug === currentSlug && (
                    <DropdownMenuShortcut>
                      <Check className="size-4 shrink-0 text-fg-brand" />
                    </DropdownMenuShortcut>
                  )}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
            <DropdownMenuSeparator />

            <DropdownMenuItem className="text-xs cursor-pointer p-2">
              <Link
                href="/onboarding/create-org"
                className="flex items-center gap-2"
              >
                <div className="flex size-6 items-center justify-center rounded-md border bg-transparent">
                  <Plus className="size-3.5 text-fg-muted" />
                </div>
                <span className="font-medium text-fg-muted">
                  Создать компанию
                </span>
              </Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
