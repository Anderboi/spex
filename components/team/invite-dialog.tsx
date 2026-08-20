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
  DialogTrigger,
} from "@/components/ui/dialog";
import { UserPlus, Copy, Check, Loader2 } from "lucide-react";
import { createInvite } from "@/actions/teams";

export function InviteDialog({ orgSlug }: { orgSlug: string }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function handleSubmit(formData: FormData) {
    setLoading(true);
    setError(null);
    setInviteUrl(null);

    const res = await createInvite(orgSlug, formData);

    if (!res.success) {
      setError(res.error);
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

  return (
    <Dialog
      open={open}
      onOpenChange={(val) => {
        setOpen(val);
        if (!val) setInviteUrl(null);
      }}
    >
      <DialogTrigger render={<Button className="gap-2" size="lg" />}>
        <UserPlus className="size-4" />
        Пригласить участника
      </DialogTrigger>
      <DialogContent className="sm:max-w-120 bg-bg-card">
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
              <Select name="role" defaultValue="member">
                <SelectTrigger className="w-full h-10!">
                  <SelectValue />
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
              <Input value={inviteUrl} readOnly className="text-xs font-mono" />
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
              onClick={() => setOpen(false)}
            >
              Готово
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
