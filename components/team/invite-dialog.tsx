"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { UserPlus, Copy, Check, Loader2 } from "lucide-react";
import Link from "next/link";
import { createInvite } from "@/actions/teams";
import { useDialogUrl } from "@/hooks/use-dialog-url";

const roleLabels: Record<string, string> = {
  member: "Участник",
  admin: "Администратор",
};

export function InviteDialog({ orgSlug }: { orgSlug: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const { value: dialog, hrefFor, close: closeDialog } = useDialogUrl("dialog");

  // Диалог управляется URL: ?dialog=invite
  const isOpen = dialog === "invite";
  const inviteHref = hrefFor("invite");

  // Сброс одноразового состояния (результат приглашения, ошибки) при каждом
  // открытии — паттерн «adjust state during render» из документации React:
  // без эффектов, чтобы состояние не переживало закрытие через «Назад».
  const [prevOpen, setPrevOpen] = useState(isOpen);
  if (prevOpen !== isOpen) {
    setPrevOpen(isOpen);
    if (isOpen) {
      setInviteUrl(null);
      setError(null);
      setCopied(false);
    }
  }

  async function handleSubmit(formData: FormData) {
    setLoading(true);
    setError(null);
    setInviteUrl(null);

    const res = await createInvite(orgSlug, formData);

    if (!res.success) {
      setError(res.error);
      setLoading(false);
      return;
    }
    setInviteUrl(res.data.inviteUrl);
    setLoading(false);
  }

  const copyToClipboard = () => {
    if (inviteUrl) {
      navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const [role, setRole] = useState("member");

  return (
    <>
      <Button
        nativeButton={false}
        render={<Link className="gap-2" href={inviteHref} />}
        size="lg"
      >
        <UserPlus className="size-4" />
        Пригласить участника
      </Button>

      <Dialog
        open={isOpen}
        onOpenChange={(val) => {
          if (!val) closeDialog();
        }}
      >
        <DialogContent className="sm:max-w-120 bg-bg">
          <DialogHeader>
            <DialogTitle>Приглашение в команду</DialogTitle>
          </DialogHeader>

          {!inviteUrl ? (
            <form action={handleSubmit} className="space-y-4 pt-2">
              <div className="space-y-2">
                <Label htmlFor="email">Email сотрудника</Label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  placeholder="colleague@studio.com"
                  required
                  className="h-10"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="role">Роль</Label>
                <RoleSelect />
              </div>

              {error && (
                <p className="text-xs text-destructive font-medium">{error}</p>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <Button type="submit" disabled={loading} size="lg">
                  {loading && <Loader2 className="mr-2 size-4 animate-spin" />}
                  Создать ссылку
                </Button>
              </div>
            </form>
          ) : (
            <div className="space-y-4 pt-2">
              <p className="text-sm text-fg-muted">
                Приглашение создано. Передайте эту ссылку сотруднику:
              </p>
              <div className="flex items-center gap-2">
                <Input
                  value={inviteUrl}
                  readOnly
                  className="text-xs font-mono"
                />
                <Button size="icon" variant="outline" onClick={copyToClipboard}>
                  {copied ? (
                    <Check className="size-4 text-emerald-500" />
                  ) : (
                    <Copy className="size-4" />
                  )}
                </Button>
              </div>
              <Button
                className="w-full"
                variant="secondary"
                onClick={closeDialog}
              >
                Готово
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

export default function RoleSelect() {
  // 2. Добавляем стейт для отслеживания выбранного значения (начиная с дефолтного)
  const [role, setRole] = useState("member");

  return (
    <Select
      name="role"
      value={role}
      onValueChange={(val) => setRole(val ?? "")}
    >
      <SelectTrigger className="w-full h-10! bg-bg-card">
        {/* 3. Передаем короткое название внутрь SelectValue */}
        <SelectValue>{roleLabels[role] ?? "Выберите роль"}</SelectValue>
      </SelectTrigger>

      <SelectContent className="w-fit bg-bg-card">
        <SelectItem value="member" className="h-10">
          Участник (Просмотр и редактирование)
        </SelectItem>
        <SelectItem value="admin" className="h-10">
          Администратор (Управление проектами и командой)
        </SelectItem>
      </SelectContent>
    </Select>
  );
}
