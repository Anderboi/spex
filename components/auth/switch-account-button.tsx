"use client";

import { useTransition } from "react";
import { LogOut } from "lucide-react";

import { Button } from "@/components/ui/button";
import { logoutTo } from "@/actions/auth";

/**
 * «Войти под другим адресом»: выход из текущего аккаунта с возвратом на
 * страницу приглашения. Без выхода войти заново нельзя — /login уводит уже
 * вошедшего пользователя в приложение.
 */
export function SwitchAccountButton({ returnTo }: { returnTo: string }) {
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      variant="outline"
      size="lg"
      className="w-full"
      disabled={isPending}
      onClick={() => startTransition(() => void logoutTo(returnTo))}
    >
      <LogOut className="size-4" />
      {isPending ? "Выходим…" : "Войти под другим адресом"}
    </Button>
  );
}
