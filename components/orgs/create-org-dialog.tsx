"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Plus, Building2, Loader2 } from "lucide-react";
import { createOrganization } from "@/app/(auth)/actions";
import { useRouter } from "next/navigation";

export async function createOrganizationFromForm(formData: FormData) {
  return createOrganization({ name: String(formData.get("name") ?? "") });
}
export function CreateOrgDialog({
  onOpenChange,
}: {
  onOpenChange?: (v: boolean) => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    // ← 'e' объявлен здесь
    e.preventDefault();
    setError(null);
    const name = String(new FormData(e.currentTarget).get("name") ?? "");

    startTransition(async () => {
      const result = await createOrganization({ name });

      if (!result.success) {
        setError(result.error);
        return;
      }

      onOpenChange?.(false);
      router.refresh();
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger>
        <Button
          variant="outline"
          size="sm"
          className="w-full justify-start gap-2"
        >
          <Plus className="size-4" />
          <span>Новая организация</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-106">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Building2 className="size-5 text-primary" />
            Создать организацию
          </DialogTitle>
          <DialogDescription>
            Введите название вашей студии или компании для совместной работы.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4 pt-2">
          <div className="space-y-2">
            <Label htmlFor="name">Название</Label>
            <Input
              id="name"
              name="name"
              placeholder="Например: Studio Minimal"
              required
              disabled={isPending}
            />
          </div>

          {error && (
            <p className="text-xs text-destructive font-medium">{error}</p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={isPending}
            >
              Отмена
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
              Создать
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
