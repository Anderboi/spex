import { getSessionContext } from "@/lib/auth/session";
import { lookupInvite } from "@/lib/queries";
import { resolveInviteView } from "@/lib/invites";
import { ROLE_LABELS, type InviteRole } from "@/lib/permissions";
import { fmtDate } from "@/lib/utils";
import { AcceptInviteForm } from "@/components/auth/accept-invite-form";
import { SwitchAccountButton } from "@/components/auth/switch-account-button";
import { Button } from "@/components/ui/button";
import { AlertCircle, Building2, Clock, Mail } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

export const metadata = { title: "Приглашение" };

interface PageProps {
  searchParams: Promise<{ token?: string }>;
}

/**
 * У группы `(auth)` нет своего макета, поэтому карточку рисуем здесь.
 */
function Card({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-svh flex flex-col items-center justify-center p-4">
      <div className="max-w-md w-full p-8 border rounded-xl shadow-sm text-center space-y-6 bg-card">
        {children}
      </div>
    </div>
  );
}

function Notice({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <Card>
      <div className="p-4 bg-primary/10 text-primary rounded-full w-fit mx-auto">
        {icon}
      </div>
      <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
      <div className="text-sm text-muted-foreground space-y-4">{children}</div>
    </Card>
  );
}

function HomeButton() {
  return (
    <Button
      size="lg"
      variant="outline"
      nativeButton={false}
      render={<Link href="/" />}
    >
      На главную
    </Button>
  );
}

/** Роль приглашения в тексте: «Администратор» → «администратор». */
function roleText(role: InviteRole) {
  return ROLE_LABELS[role].toLowerCase();
}

export default async function AcceptInvitePage({ searchParams }: PageProps) {
  const { token } = await searchParams;

  if (!token) {
    return (
      <Notice
        icon={<AlertCircle className="size-8" />}
        title="Неверная ссылка"
      >
        <p>Токен приглашения отсутствует.</p>
        <HomeButton />
      </Notice>
    );
  }

  const [lookup, session] = await Promise.all([
    lookupInvite(token),
    getSessionContext(),
  ]);

  const view = resolveInviteView({
    lookup,
    signedIn: session !== null,
    sessionEmail: session?.user.email ?? null,
  });

  // Ссылка на возврат: вход и регистрация не должны терять токен.
  const invitePath = `/invite/accept?token=${encodeURIComponent(token)}`;

  switch (view.kind) {
    case "unavailable":
      return (
        <Notice
          icon={<AlertCircle className="size-8" />}
          title="Приглашение недействительно"
        >
          <p>
            Ссылка уже использована, отозвана или скопирована не полностью.
            Попросите отправить приглашение заново.
          </p>
          <HomeButton />
        </Notice>
      );

    case "error":
      return (
        <Notice
          icon={<AlertCircle className="size-8" />}
          title="Не удалось проверить приглашение"
        >
          <p>
            Мы не смогли прочитать приглашение. Обновите страницу — если не
            поможет, попросите отправить ссылку заново.
          </p>
        </Notice>
      );

    case "expired":
      return (
        <Notice
          icon={<Clock className="size-8" />}
          title="Срок действия истёк"
        >
          <p>
            Приглашение в студию «{view.invite.org_name}» действовало до{" "}
            {fmtDate(view.invite.expires_at)}. Попросите отправить новое.
          </p>
          <HomeButton />
        </Notice>
      );

    case "login":
      return (
        <Card>
          <div className="p-4 bg-primary/10 text-primary rounded-full w-fit mx-auto">
            <Building2 className="size-8" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              Вас пригласили в «{view.invite.org_name}»
            </h1>
            <p className="text-sm text-muted-foreground mt-2">
              Приглашение выписано на {view.invite.email}. Войдите под этим
              адресом — роль в студии: {roleText(view.invite.role)}.
            </p>
          </div>
          <Button
            size="lg"
            className="w-full"
            nativeButton={false}
            render={
              <Link
                href={`/login?callbackUrl=${encodeURIComponent(invitePath)}`}
              />
            }
          >
            Войти и принять
          </Button>
          <p className="text-xs text-muted-foreground">
            Нет аккаунта?{" "}
            <Link className="underline underline-offset-2" href="/register">
              Зарегистрируйтесь
            </Link>{" "}
            на этот адрес (после подтверждения почты вернитесь по этой ссылке).
          </p>
        </Card>
      );

    case "wrong_account":
      return (
        <Notice
          icon={<Mail className="size-8" />}
          title="Приглашение на другой адрес"
        >
          <p>
            Приглашение в студию «{view.invite.org_name}» выписано на{" "}
            <span className="font-medium text-foreground">
              {view.invite.email}
            </span>
            {view.sessionEmail
              ? `, а вы вошли как ${view.sessionEmail}.`
              : ", а в вашем профиле не указан email."}
          </p>
          <SwitchAccountButton returnTo={invitePath} />
        </Notice>
      );

    case "accept":
      return (
        <Card>
          <div className="p-4 bg-primary/10 text-primary rounded-full w-fit mx-auto">
            <Building2 className="size-8" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              Вас пригласили в «{view.invite.org_name}»
            </h1>
            <p className="text-sm text-muted-foreground mt-2">
              Примите приглашение, чтобы получить доступ к проектам и материалам
              организации. Роль в студии: {roleText(view.invite.role)}.
            </p>
          </div>
          <AcceptInviteForm token={token} />
        </Card>
      );
  }
}
