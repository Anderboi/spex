"use client";

import { useState, useTransition } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuGroup,
} from "@/components/ui/dropdown-menu";
import { Building2, Check, ChevronsUpDown, Loader2, Plus } from "lucide-react";
import { switchOrganization } from "@/app/(auth)/actions";
import Link from "next/link";
import { useRouter } from "next/navigation";

export type UserOrgItem = {
  id: string;
  name: string;
  role: string;
};

interface OrgSwitcherProps {
  currentOrgId: string | null;
  organizations: UserOrgItem[];
}

export function OrgSwitcher({
  currentOrgId,
  organizations = [],
}: OrgSwitcherProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const currentOrg =
    organizations.find((org) => org.id === currentOrgId) || organizations[0];
  const handleSwitch = (orgId: string) => {
    if (orgId === currentOrgId) return;

    startTransition(async () => {
      const res = await switchOrganization(orgId);
      if (!res.success) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={isPending}
        className="w-full bg-bg-card rounded-lg"
      >
        <span
          role="button"
          className="justify-between items-center flex h-10 px-3"
        >
          <div className="flex items-center gap-2 truncate">
            {isPending ? (
              <Loader2 className="size-4 animate-spin text-fg-muted shrink-0" />
            ) : (
              <Building2 className="size-4 shrink-0 text-fg-muted" />
            )}
            <span className="truncate font-medium text-xs">
              {currentOrg ? currentOrg.name : "Выберите компанию"}
            </span>
          </div>
          <ChevronsUpDown className="size-3 shrink-0 opacity-50" />
        </span>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="//w-50 bg-bg-card">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="text-xs text-fg-muted">
            Организации
          </DropdownMenuLabel>

          {organizations.map((org) => {
            const isSelected = org.id === currentOrgId;
            return (
              <DropdownMenuItem
                key={org.id}
                onClick={() => handleSwitch(org.id)}
                className="flex items-center justify-between text-xs cursor-pointer "
              >
                <span className="truncate">{org.name}</span>
                {isSelected && <Check className="size-3.5 text-fg-brand" />}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem className="text-xs cursor-pointer">
            <Link
              href="/onboarding/create-org"
              className="flex items-center gap-2"
            >
              <Plus className="size-3.5" />
              <span>Создать компанию</span>
            </Link>
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
