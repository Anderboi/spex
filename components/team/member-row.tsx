"use client";

import { useState, useTransition } from "react";
import {
  OrgRole,
  ROLE_LABELS,
  canRemoveMember,
  canTransferOwnership,
  canUpdateMemberRole,
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
import {
  MoreHorizontal,
  Shield,
  ShieldCheck,
  UserMinus,
  Crown,
  Loader2,
} from "lucide-react";
import { removeMember, updateMemberRole } from "@/actions/teams";
import { transferOwnership } from "@/actions/organization";
import { Avatar, AvatarFallback, AvatarImage } from "../ui/avatar";
import { ConfirmDialog } from "../ui/confirm-dialog";
import { cn } from "@/lib/utils";

interface MemberRowProps {
  orgSlug: string;
  /** Название организации — для текста подтверждения передачи владения. */
  organizationName: string;
  member: TeamMember;
  currentUserRole: OrgRole;
  currentUserId: string;
}

export function MemberRow({
  orgSlug,
  organizationName,
  member,
  currentUserRole,
  currentUserId,
}: MemberRowProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [confirmTransfer, setConfirmTransfer] = useState(false);

  const isSelf = member.user_id === currentUserId;
  const isOwner = member.role === "owner";

  const displayName =
    member.profile?.name || member.profile?.email || "Пользователь";
  const initials = displayName.slice(0, 2).toUpperCase();

  // ── что доступно текущему пользователю по отношению к этому участнику ──
  // Это только UI-гейт: те же проверки повторяются в server actions и в БД.
  const canSetMember = canUpdateMemberRole({
    currentRole: currentUserRole,
    targetRole: member.role,
    newRole: "member",
    isSelf,
  });
  const canSetAdmin = canUpdateMemberRole({
    currentRole: currentUserRole,
    targetRole: member.role,
    newRole: "admin",
    isSelf,
  });
  const canSetViewer = canUpdateMemberRole({
    currentRole: currentUserRole,
    targetRole: member.role,
    newRole: "viewer",
    isSelf,
  });
  const allowRoleChange = canSetMember || canSetAdmin || canSetViewer;
  const allowRemove = canRemoveMember({
    currentRole: currentUserRole,
    targetRole: member.role,
    isSelf,
  });
  const allowTransfer = canTransferOwnership(currentUserRole, member.role, isSelf);
  const hasActions = allowRoleChange || allowRemove || allowTransfer;

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
      if (!res.success) setError(res.error);
    });
  };

  const handleTransfer = () => {
    setConfirmTransfer(false);
    setError(null);
    startTransition(async () => {
      const res = await transferOwnership(orgSlug, member.user_id);
      if (!res.success) setError(res.error);
    });
  };

  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 p-4 rounded-lg border bg-bg-card2 transition-colors",
        isOwner ? "border-amber-500" : "hover:bg-bg-accent/5",
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
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
            {isSelf && (
              <Badge variant="outline" className="text-[10px] h-4 px-1.5 py-0">
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
          variant={isOwner ? "default" : member.role === "admin" ? "secondary" : "outline"}
          className={cn(
            "gap-1",
            isOwner &&
              "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400",
          )}
        >
          {isOwner && (
            <Crown className="size-3 text-amber-500 fill-amber-500/20" />
          )}
          {member.role === "admin" && <ShieldCheck className="size-3" />}
          {ROLE_LABELS[member.role]}
        </Badge>

        {hasActions && (
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

            <DropdownMenuContent align="end" className="w-52">
              {allowRoleChange && (
                <DropdownMenuRadioGroup
                  value={member.role}
                  onValueChange={handleRoleChange}
                >
                  <DropdownMenuLabel className="text-xs">
                    Изменить роль
                  </DropdownMenuLabel>
                  <DropdownMenuRadioItem value="member" disabled={!canSetMember}>
                    {ROLE_LABELS.member}
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="admin" disabled={!canSetAdmin}>
                    {ROLE_LABELS.admin}
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem
                    value="viewer"
                    disabled={!canSetViewer}
                  >
                    {ROLE_LABELS.viewer}
                  </DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              )}

              {allowRoleChange && (allowTransfer || allowRemove) && (
                <DropdownMenuSeparator />
              )}

              {allowTransfer && (
                <DropdownMenuItem
                  onClick={() => setConfirmTransfer(true)}
                  className="cursor-pointer"
                >
                  <Shield className="size-4 mr-2 text-amber-500" />
                  Передать владение
                </DropdownMenuItem>
              )}

              {allowTransfer && allowRemove && <DropdownMenuSeparator />}

              {allowRemove && (
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() => setConfirmRemove(true)}
                  className="cursor-pointer"
                >
                  <UserMinus className="size-4 mr-2" />
                  Удалить из команды
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {error && (
        <p role="alert" className="w-full text-xs text-destructive">
          {error}
        </p>
      )}

      <ConfirmDialog
        open={confirmRemove}
        title={`Удалить ${displayName} из команды?`}
        description="Доступ к студии пропадёт сразу. Созданные проекты, материалы и контакты останутся — у них сохранится прежний автор. Вернуть участника можно новым приглашением."
        confirmLabel="Удалить"
        destructive
        autoFocusCancel
        onConfirm={handleRemove}
        onCancel={() => setConfirmRemove(false)}
      />

      {/* Передача владения — не обычная смена роли, поэтому отдельное
          подтверждение с последствиями для обеих сторон. */}
      <ConfirmDialog
        open={confirmTransfer}
        title="Передать владение организацией?"
        description={`${displayName} станет владельцем организации «${organizationName}». Вы будете назначены администратором и потеряете права владельца.`}
        confirmLabel="Передать владение"
        autoFocusCancel
        onConfirm={handleTransfer}
        onCancel={() => setConfirmTransfer(false)}
      />
    </div>
  );
}
