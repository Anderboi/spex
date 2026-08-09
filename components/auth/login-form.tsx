"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Mail, Lock, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { loginWithCredentials } from '@/app/(auth)/actions';

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") || "/dashboard";

  const [isPending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);

const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
  e.preventDefault();
  setError(null);

  const formData = new FormData(e.currentTarget);
  const res = await loginWithCredentials(formData);

  if (res?.error) {
    setError(res.error);
  } else if (res?.success) {
    // Явно выполняем переход и обновляем сессию
    router.push("/projects");
    router.refresh();
  }
};

  return (
    <Card className="w-full max-w-md shadow-xl border-border/60">
      <CardHeader className="text-center space-y-1">
        <CardTitle className="text-2xl font-bold">Вход в систему</CardTitle>
        <CardDescription>
          Выберите удобный способ входа для доступа к вашему аккаунту
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Кнопка входа через Google */}
        <Button
          variant="outline"
          type="button"
          className="w-full h-11 font-medium"
          disabled={isPending}
        >
          <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24">
            <path
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              fill="#4285F4"
            />
            <path
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              fill="#34A853"
            />
            <path
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
              fill="#FBBC05"
            />
            <path
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
              fill="#EA4335"
            />
          </svg>
          Войти через Google
        </Button>

        <div className="relative flex items-center justify-center text-xs uppercase my-4">
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t border-border" />
          </div>
          <span className="relative bg-card px-2 text-muted-foreground font-medium">
            ИЛИ ПО EMAIL
          </span>
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          {error && (
            <div className="p-3 text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-md">
              {error}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <div className="relative">
              <Mail className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                id="email"
                name="email"
                type="email"
                placeholder="name@example.com"
                className="pl-9"
                required
                disabled={isPending}
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="password">Пароль</Label>
              <Link
                href="/forgot-password"
                className="text-xs text-muted-foreground hover:text-primary transition-colors"
              >
                Забыли пароль?
              </Link>
            </div>
            <div className="relative">
              <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                id="password"
                name="password"
                type="password"
                placeholder="••••••••"
                className="pl-9"
                required
                disabled={isPending}
              />
            </div>
          </div>

          <Button type="submit" className="w-full h-11" disabled={isPending}>
            {isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Вход...
              </>
            ) : (
              "Войти"
            )}
          </Button>
        </form>
      </CardContent>

      <CardFooter className="flex flex-col space-y-3 text-center border-t border-border/40 pt-4 text-xs text-muted-foreground">
        <div>
          Ещё нет аккаунта?{" "}
          <Link
            href={
              callbackUrl !== "/projects"
                ? `/register?callbackUrl=${encodeURIComponent(callbackUrl)}`
                : "/register"
            }
            className="font-semibold text-primary hover:underline"
          >
            Зарегистрироваться
          </Link>
        </div>

        <p className="text-[11px] leading-tight">
          Нажимая «Войти», вы соглашаетесь с условиями обслуживания
        </p>
      </CardFooter>
    </Card>
  );
}

export default LoginForm