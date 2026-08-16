"use client";

import { useState, useTransition } from "react";
import {
  OrgRole,
  ROLE_LABELS,
  canChangeRole,
  canRemoveMember,
} from "@/lib/permissions";
import type { TeamMember } from "@/lib/queries";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MoreHorizontal, Shield, UserMinus, Loader2 } from "lucide-react";
import { removeMember, updateMemberRole } from "@/actions/teams";
import { Avatar, AvatarFallback, AvatarImage } from "../ui/avatar";

interface MemberRowProps {
  member: TeamMember;
  currentUserRole: OrgRole;
  currentUserId: string;
}

export function MemberRow({
  member,
  currentUserRole,
  currentUserId,
}: MemberRowProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const isSelf = member.user_id === currentUserId;
  const allowRoleChange =
    !isSelf && canChangeRole(currentUserRole, member.role, "member");
  const allowRemove = !isSelf && canRemoveMember(currentUserRole, member.role);

  const displayName =
    member.profile?.name || member.profile?.email || "Пользователь";
  const initials = displayName.slice(0, 2).toUpperCase();

  const handleRoleChange = (value: string) => {
    const newRole = value as OrgRole;
    setError(null);
    startTransition(async () => {
      const res = await updateMemberRole(member.user_id, newRole);
      if (!res.success) setError(res.error);
    });
  };

  const handleRemove = () => {
    if (
      !confirm(
        `Вы уверены, что хотите исключить ${displayName || member.profile?.email} из организации?`,
      )
    ) {
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        await removeMember(member.user_id, member.role);
      } catch (err: any) {
        setError(err.message || "Ошибка при удалении участника");
      }
    });
  };

  return (
    <div className="flex items-center justify-between p-4 rounded-lg border bg-bg-card2 hover:bg-bg-accent/5 transition-colors">
      {error && (
        <p role="alert" className="mt-1 text-xs text-destructive">
          {error}
        </p>
      )}
      <div className="flex items-center gap-3">
        <Avatar className="size-10 bg-bg-brand2">
          <AvatarImage src={member.profile?.image || undefined} alt="" />
          <AvatarFallback className="text-xs font-semibold">
            {initials}
          </AvatarFallback>
        </Avatar>

        <div className="space-y-0.5">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium leading-none">
              {displayName}
            </span>
            {member.is_me && (
              <Badge variant="outline" className="text-[10px] h-4 px-1.5 py-0">
                Вы
              </Badge>
            )}
          </div>
          <p className="text-xs text-fg-muted">
            {member.profile?.email}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Badge
          variant={
            member.role === "owner"
              ? "default"
              : member.role === "admin"
                ? "secondary"
                : "outline"
          }
          className="capitalize gap-1"
        >
          {member.role === "owner" && (
            <Shield className="size-3 text-amber-500 fill-amber-500/20" />
          )}
          {ROLE_LABELS[member.role]}
        </Badge>

        {(allowRoleChange || allowRemove) && (
          <DropdownMenu>
            <DropdownMenuTrigger disabled={isPending}>
              <span role="button" className="size-8">
                {isPending ? (
                  <Loader2 className="size-4 animate-spin text-fg-muted" />
                ) : (
                  <MoreHorizontal className="size-4" />
                )}
              </span>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              {allowRoleChange && (
                <>
                  <DropdownMenuLabel className="text-xs">
                    Изменить роль
                  </DropdownMenuLabel>
                  <DropdownMenuRadioGroup
                    value={member.role}
                    onValueChange={handleRoleChange}
                  >
                    <DropdownMenuRadioItem value="member">
                      Участник
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem
                      value="admin"
                      disabled={
                        !canChangeRole(currentUserRole, member.role, "admin")
                      }
                    >
                      Администратор
                    </DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>
                </>
              )}

              {allowRoleChange && allowRemove && <DropdownMenuSeparator />}

              {allowRemove && (
                <DropdownMenuItem
                  onClick={handleRemove}
                  className="text-destructive focus:text-destructive cursor-pointer"
                >
                  <UserMinus className="size-4 mr-2" />
                  Исключить
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  );
}
