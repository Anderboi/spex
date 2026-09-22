"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { AlertTriangle, Building2, Loader2, Trash2 } from "lucide-react";
import { deleteOrganization, updateOrganization } from "@/actions/organization";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

const EMPTY_ROLES_HINT =
  "Изменять название и удалять организацию может только владелец.";

/**
 * Название организации.
 *
 * Поле показываем всем участникам (название не секрет), но сохранять его может
 * только владелец: для остальных поле выключено. Ограничение не в UI —
 * server action `updateOrganization` и RPC `update_organization_name` проверяют
 * роль ещё раз.
 */
export function OrganizationSettingsCard({
  orgSlug,
  organizationName,
  canUpdate,
}: {
  orgSlug: string;
  organizationName: string;
  canUpdate: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [name, setName] = useState(organizationName);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const trimmed = name.trim();
  const isDirty = trimmed !== organizationName.trim();
  const canSave = canUpdate && isDirty && trimmed.length >= 2 && !isPending;

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setSaved(false);

    startTransition(async () => {
      const res = await updateOrganization(orgSlug, { name });
      if (!res.success) {
        setError(res.error);
        return;
      }
      // Сервер вернул сохранённое (уже обрезанное) название — показываем его,
      // чтобы UI не расходился с БД до прихода свежих данных.
      setName(res.data.name);
      setSaved(true);
      router.refresh();
    });
  };

  return (
    <Card className="bg-bg-card border-border">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Building2 className="size-5 text-fg-muted" />
          <CardTitle className="text-lg">Настройки организации</CardTitle>
        </div>
        <CardDescription>
          {canUpdate
            ? "Название организации видно всем участникам команды."
            : EMPTY_ROLES_HINT}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="org-name">Название организации</Label>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Input
                id="org-name"
                name="name"
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                  setSaved(false);
                  setError(null);
                }}
                disabled={!canUpdate || isPending}
                maxLength={80}
                autoComplete="organization"
                className="sm:max-w-sm"
              />
              {canUpdate && (
                <Button type="submit" disabled={!canSave} size='lg' className="shrink-0 h-10">
                  {isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
                  Сохранить
                </Button>
              )}
            </div>
            <p className="text-xs text-fg-muted">
              Адрес организации (slug) не меняется — он остаётся прежним.
            </p>
          </div>

          {error && (
            <p role="alert" className="text-xs font-medium text-destructive">
              {error}
            </p>
          )}
          {saved && !error && (
            <p className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
              Название сохранено
            </p>
          )}
        </form>
      </CardContent>
    </Card>
  );
}

/**
 * Опасная зона: удаление организации.
 *
 * Показывается только владельцу. Кнопка активируется лишь после точного ввода
 * названия — это UI-предохранитель, а сервер всё равно сверяет название сам
 * (`deleteOrganization`).
 */
export function DangerZoneCard({
  orgSlug,
  organizationName,
}: {
  orgSlug: string;
  organizationName: string;
}) {
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const matches = confirmation.trim() === organizationName.trim();

  const openDialog = () => {
    setConfirmation("");
    setError(null);
    setOpen(true);
  };

  const handleDelete = () => {
    setError(null);
    startTransition(async () => {
      // При успехе действие делает redirect — управление сюда не вернётся.
      const res = await deleteOrganization(orgSlug, { confirmation });
      if (!res.success) {
        setError(res.error);
        setOpen(false);
      }
    });
  };

  return (
    <Card className="border-destructive/40 bg-destructive/3">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <AlertTriangle className="size-5 text-destructive" />
          <CardTitle className="text-lg text-destructive">
            Опасная зона
          </CardTitle>
        </div>
        <CardDescription>
          Удаление организации необратимо. Будут удалены организация и связанные
          с ней данные: проекты, спецификации, материалы, контакты и файлы.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Button
          type="button"
          variant="destructive"
          size="lg"
          onClick={openDialog}
          disabled={isPending}
        >
          {isPending ? (
            <Loader2 className="mr-2 size-4 animate-spin" />
          ) : (
            <Trash2 className="mr-2 size-4" />
          )}
          Удалить организацию
        </Button>

        {error && (
          <p role="alert" className="text-xs font-medium text-destructive">
            {error}
          </p>
        )}
      </CardContent>

      <ConfirmDialog
        open={open}
        title="Удаление организации"
        description={`Это действие необратимо. Все связанные данные будут удалены.\n\nВведите название организации «${organizationName}», чтобы подтвердить.`}
        confirmLabel="Удалить организацию"
        destructive
        autoFocusCancel
        confirmDisabled={!matches}
        pending={isPending}
        onConfirm={handleDelete}
        onCancel={() => setOpen(false)}
      >
        <div className="mt-3 space-y-1.5">
          <Label htmlFor="org-delete-confirmation">Название организации</Label>
          <Input
            id="org-delete-confirmation"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            placeholder={organizationName}
            autoComplete="off"
            aria-invalid={confirmation.length > 0 && !matches}
          />
          {confirmation.length > 0 && !matches && (
            <p className="text-xs text-fg-muted">Название не совпадает</p>
          )}
        </div>
      </ConfirmDialog>
    </Card>
  );
}
