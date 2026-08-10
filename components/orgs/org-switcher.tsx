"use client";

import { useTransition } from "react";
import type { UserOrganization } from "@/lib/queries";
import { CreateOrgDialog } from "./create-org-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Building2, Check, ChevronsUpDown, Loader2 } from "lucide-react";
import { switchOrganization } from "@/app/(auth)/actions";

export function OrgSwitcher({ orgs }: { orgs: UserOrganization[] }) {
  const [isPending, startTransition] = useTransition();
  const activeOrg = orgs.find((o) => o.is_active) || orgs[0];

  const handleSelect = (orgId: string) => {
    if (orgId === activeOrg?.id) return;
    startTransition(async () => {
      await switchOrganization(orgId);
    });
  };

  return (
    <div className="space-y-2 w-full">
      <DropdownMenu>
        <DropdownMenuTrigger disabled={isPending}>
          <Button
            variant="outline"
            className="w-full justify-between px-3 font-normal"
          >
            <div className="flex items-center gap-2 truncate">
              {isPending ? (
                <Loader2 className="size-4 animate-spin text-muted-foreground" />
              ) : (
                <Building2 className="size-4 text-muted-foreground" />
              )}
              <span className="truncate font-medium">
                {activeOrg?.name || "Выберите организацию"}
              </span>
            </div>
            <ChevronsUpDown className="size-4 opacity-50 shrink-0" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-[240px]">
          <DropdownMenuLabel className="text-xs text-muted-foreground">
            Организации
          </DropdownMenuLabel>
          {orgs.map((org) => (
            <DropdownMenuItem
              key={org.id}
              onClick={() => handleSelect(org.id)}
              className="flex items-center justify-between cursor-pointer"
            >
              <span className="truncate">{org.name}</span>
              {org.is_active && <Check className="size-4 text-primary" />}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <div className="p-1">
            <CreateOrgDialog />
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
