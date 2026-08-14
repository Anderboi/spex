import { getTeamData } from "@/lib/queries";
import { canManageMembers } from "@/lib/permissions";
import { InviteDialog } from "@/components/team/invite-dialog";
import { MemberRow } from "@/components/team/member-row";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Users, Mail, Clock } from "lucide-react";

export const metadata = {
  title: "Управление командой | Spex",
};

export default async function TeamSettingsPage() {
  const { members, invites, currentUserRole, currentUserId } =
    await getTeamData();
  const hasAdminAccess = canManageMembers(currentUserRole);

  return (
    <div className="max-w-4xl mx-auto space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Управление командой
          </h1>
          <p className="text-sm text-muted-foreground">
            Управляйте составом вашей организации, ролями и доступами
            сотрудников.
          </p>
        </div>

        {hasAdminAccess && <InviteDialog />}
      </div>

      {/* Список участников */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Users className="size-5 text-muted-foreground" />
            <CardTitle className="text-lg">
              Участники ({members.length})
            </CardTitle>
          </div>
          <CardDescription>
            Сотрудники, имеющие доступ к материалам и проектам организации.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {members.map((member) => (
            <MemberRow
              key={member.id}
              member={member}
              currentUserRole={currentUserRole}
              currentUserId={currentUserId}
            />
          ))}
        </CardContent>
      </Card>

      {/* Ожидающие приглашения */}
      {hasAdminAccess && invites.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <Mail className="size-5 text-muted-foreground" />
              <CardTitle className="text-lg">
                Ожидающие приглашения ({invites.length})
              </CardTitle>
            </div>
            <CardDescription>
              Приглашения, отправленные сотрудникам, но еще не принятые ими.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {invites.map((invite) => (
              <div
                key={invite.id}
                className="flex items-center justify-between p-3 rounded-lg border bg-muted/20 text-sm"
              >
                <div className="flex items-center gap-3">
                  <Clock className="size-4 text-muted-foreground shrink-0" />
                  <span className="font-medium">{invite.email}</span>
                </div>

                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-xs">
                    {invite.role === "admin" ? "Администратор" : "Участник"}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    до {new Date(invite.expires_at).toLocaleDateString("ru-RU")}
                  </span>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
