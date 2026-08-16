"use client";

import * as React from "react";
import { useRouter } from "next/navigation"; // ← App Router, не next/router
import { Building2, Loader2 } from "lucide-react";
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
import { createOrganization } from "@/app/(auth)/actions";

export function CreateOrgForm({ defaultName = "" }: { defaultName?: string }) {
  const router = useRouter();
  const [isPending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    const name = String(new FormData(e.currentTarget).get("name") ?? "");

    startTransition(async () => {
      const res = await createOrganization({ name });
      if (!res.success) {
        setError(res.error);
        return;
      }
      router.replace("/projects");
      router.refresh(); // без этого сессия останется с orgId: null
    });
  };

  return (
    <Card className="w-full max-w-md border-border shadow-lg">
      <CardHeader className="space-y-2 text-center">
        <div className="mx-auto w-fit rounded-full bg-primary/10 p-3 text-primary">
          <Building2 className="size-8" />
        </div>
        <CardTitle className="text-2xl font-bold">Добро пожаловать</CardTitle>
        <CardDescription>
          Создайте вашу студию. Пригласить коллег можно будет позже.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          {error && (
            <div
              role="alert"
              className="rounded-md border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive"
            >
              {error}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="name">Название организации / студии</Label>
            <Input
              id="name"
              name="name"
              defaultValue={defaultName}
              placeholder="Например: Studio Minimal"
              required
              minLength={2}
              maxLength={80}
              autoFocus
              disabled={isPending}
            />
          </div>

          <Button
            type="submit"
            size="lg"
            className="w-full"
            disabled={isPending}
          >
            {isPending ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" /> Создаём...
              </>
            ) : (
              "Создать и продолжить"
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
