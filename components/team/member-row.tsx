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
import { ConfirmDialog } from "../ui/confirm-dialog";

interface MemberRowProps {
  orgSlug: string;
  member: TeamMember;
  currentUserRole: OrgRole;
  currentUserId: string;
}

export function MemberRow({
  orgSlug,
  member,
  currentUserRole,
  currentUserId,
}: MemberRowProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const isSelf = member.user_id === currentUserId;
  const canSetMember =
    !isSelf && canChangeRole(currentUserRole, member.role, "member");
  const canSetAdmin =
    !isSelf && canChangeRole(currentUserRole, member.role, "admin");
  const allowRoleChange = canSetMember || canSetAdmin;
  const allowRemove = !isSelf && canRemoveMember(currentUserRole, member.role);

  const displayName =
    member.profile?.name || member.profile?.email || "Пользователь";
  const initials = displayName.slice(0, 2).toUpperCase();

  const handleRoleChange = (value: string) => {
    setError(null);
    startTransition(async () => {
      const res = await updateMemberRole(
        orgSlug,
        member.user_id,
        value as OrgRole,
      );
      if (!res.success) setError(res.error);
    });
  };

  const handleRemove = () => {
    setConfirmRemove(false);
    setError(null);
    startTransition(async () => {
      const res = await removeMember(orgSlug, member.user_id);
      if (!res.success) setError(res.error); // ← результат больше не теряется
    });
  };

  return (
    <div className="flex items-center justify-between p-4 rounded-lg border bg-bg-card2 hover:bg-bg-accent/5 transition-colors">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center  gap-3">
          <Avatar className="size-10 shrink-0 bg-bg-brand2">
            <AvatarImage src={member.profile?.image || undefined} alt="" />
            <AvatarFallback className="text-xs font-semibold">
              {initials}
            </AvatarFallback>
          </Avatar>

          <div className="min-w-0 space-y-0.5">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm font-medium leading-none">
                {displayName}
              </span>
              {member.is_me && (
                <Badge
                  variant="outline"
                  className="text-[10px] h-4 px-1.5 py-0"
                >
                  Вы
                </Badge>
              )}
            </div>
            <p className="truncate text-xs text-fg-muted">
              {member.profile?.email}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-3">
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
              <DropdownMenuTrigger
                disabled={isPending}
                aria-label={`Действия · ${displayName}`}
                className="flex size-8 items-center justify-center rounded-md hover:bg-bg-select disabled:opacity-50"
              >
                {isPending ? (
                  <Loader2 className="size-4 animate-spin text-fg-muted" />
                ) : (
                  <MoreHorizontal className="size-4" />
                )}
              </DropdownMenuTrigger>

              <DropdownMenuContent align="end" className="w-48">
                {allowRoleChange && (
                  <>
                    <DropdownMenuRadioGroup
                      value={member.role}
                      onValueChange={handleRoleChange}
                    >
                      <DropdownMenuLabel className="text-xs">
                        Изменить роль
                      </DropdownMenuLabel>
                      <DropdownMenuRadioItem
                        value="member"
                        disabled={!canSetMember}
                      >
                        Участник
                      </DropdownMenuRadioItem>
                      <DropdownMenuRadioItem
                        value="admin"
                        disabled={!canSetAdmin}
                      >
                        Администратор
                      </DropdownMenuRadioItem>
                    </DropdownMenuRadioGroup>
                  </>
                )}

                {allowRoleChange && allowRemove && <DropdownMenuSeparator />}

                {allowRemove && (
                  <DropdownMenuItem
                    onClick={() => setConfirmRemove(true)}
                    className="text-fg-red focus:text-fg-red/50 cursor-pointer"
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
      {error && (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {error}
        </p>
      )}

      <ConfirmDialog
        open={confirmRemove}
        title={`Исключить ${displayName}?`}
        description="Доступ к студии пропадёт сразу. Созданные проекты, материалы и контакты останутся — у них сохранится прежний автор. Вернуть участника можно новым приглашением."
        confirmLabel="Исключить"
        destructive
        onConfirm={handleRemove}
        onCancel={() => setConfirmRemove(false)}
      />
    </div>
  );
}
