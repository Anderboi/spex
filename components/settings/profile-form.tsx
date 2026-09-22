"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

import { updateProfile } from "@/actions/profile";
import SaveIndicator from "@/components/layout/save-indicator";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ROLE_LABELS, type OrgRole } from "@/lib/permissions";
import { cn, initials } from "@/lib/utils";
import { updateProfileSchema } from "@/lib/validations";

type ProfileFormProps = {
  name: string;
  email: string;
  image: string | null;
  role: OrgRole;
  /** Название активной студии — для пояснения, к чему относится роль. */
  organizationName: string | null;
};

/**
 * Форма личного профиля: только те поля, которые действительно есть в модели
 * пользователя (`public.users.name` / `email` / `image`).
 *
 * Сохранение — одна кнопка и один server action. Пока имя не изменилось, кнопка
 * выключена; введённое значение не сбрасывается ни при ошибке, ни после
 * успешного сохранения.
 */
export function ProfileForm({
  name,
  email,
  image,
  role,
  organizationName,
}: ProfileFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [value, setValue] = useState(name);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const trimmed = value.trim();
  const canSave = trimmed !== name.trim() && trimmed.length > 0 && !isPending;

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    // Та же схема, что и в server action: клиент ловит ошибку до запроса,
    // сервер проверяет вход повторно и не доверяет форме.
    const parsed = updateProfileSchema.safeParse({ name: value });
    if (!parsed.success) {
      setError(parsed.error.issues[0].message);
      return;
    }

    startTransition(async () => {
      const res = await updateProfile({ name: value });
      if (!res.success) {
        setError(res.error);
        return;
      }
      // Сервер вернул уже обрезанное имя — показываем его, чтобы поле не
      // расходилось с БД до прихода свежих данных.
      setValue(res.data.name);
      setSaved(true);
      toast.success("Имя сохранено");
      // Имя показывает сайдбар: он в layout, поэтому обновляем серверные данные.
      router.refresh();
    });
  };

  const displayName = trimmed || email;
  const initial = initials(displayName) || "@";

  return (
    <Card className="bg-bg-card border-border">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg">Личные данные</CardTitle>
        <CardDescription>
          Эти данные видят участники вашей студии.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="flex items-center gap-4">
            <Avatar size="lg" className="size-14 shrink-0 bg-bg-brand2">
              <AvatarImage src={image ?? undefined} alt="" />
              <AvatarFallback className="bg-bg-brand border border-fg-brand text-base text-fg-brand">
                {initial}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 space-y-1">
              <p className="text-sm font-medium text-fg-body">Аватар</p>
              <p className="text-xs text-fg-muted">
                {image
                  ? "Аватар взят из аккаунта Google. Загрузка своего изображения пока не поддерживается."
                  : "Загрузка аватара пока не поддерживается."}
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="profile-name">Имя</Label>
            <Input
              id="profile-name"
              name="name"
              value={value}
              onChange={(event) => {
                setValue(event.target.value);
                setError(null);
                setSaved(false);
              }}
              maxLength={80}
              autoComplete="name"
              aria-invalid={Boolean(error)}
              aria-describedby={error ? "profile-name-error" : undefined}
            />
            {error ? (
              <p
                id="profile-name-error"
                role="alert"
                className="text-xs font-medium text-destructive"
              >
                {error}
              </p>
            ) : (
              <p className="text-xs text-fg-muted">
                Так вас видят другие участники студии.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="profile-email">Email</Label>
            <Input
              id="profile-email"
              value={email}
              readOnly
              className="bg-bg-card2 text-fg-secondary"
            />
            <p className="text-xs text-fg-muted">
              Email используется для входа, поэтому изменить его здесь нельзя.
            </p>
          </div>

          <div className="space-y-2">
            <span className="text-sm font-medium text-fg-body">Роль</span>
            <div>
              <Badge
                variant={
                  role === "owner"
                    ? "default"
                    : role === "admin"
                      ? "secondary"
                      : "outline"
                }
                className={cn(
                  role === "owner" &&
                    "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400",
                )}
              >
                {ROLE_LABELS[role]}
              </Badge>
            </div>
            <p className="text-xs text-fg-muted">
              Ваша роль{" "}
              {organizationName ? `в студии «${organizationName}»` : "в студии"}.
              {/* У наблюдателя только чтение, и менять его роль может лишь
                  владелец — «или администратор» здесь было бы неправдой. */}
              {role === "viewer"
                ? " Она даёт доступ только на просмотр; изменить её может владелец в разделе «Команда»."
                : " Её меняет владелец или администратор в разделе «Команда»."}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-1">
            <Button type="submit" size="lg" className="h-10" disabled={!canSave}>
              {isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
              {isPending ? "Сохранение…" : "Сохранить изменения"}
            </Button>
            <SaveIndicator
              status={isPending ? "saving" : saved ? "saved" : "idle"}
              error={null}
            />
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
