"use client";

import * as React from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Lock, CheckCircle2 } from "lucide-react";
import Link from "next/link";

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
import { NewPasswordInput, newPasswordSchema } from "@/lib/validations";
import { resetPasswordWithToken } from "../actions";

export default function ResetPasswordPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const token = searchParams.get("token");

  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<NewPasswordInput>({
    resolver: zodResolver(newPasswordSchema),
    defaultValues: { password: "", confirmPassword: "" },
  });

  const onSubmit = async (data: NewPasswordInput) => {
    if (!token) {
      setError("Отсутствует токен сброса пароля.");
      return;
    }

    setError(null);
    const res = await resetPasswordWithToken(token, data);

    if (res.error) {
      setError(res.error);
    } else if (res.success) {
      setSuccess(res.success);
      setTimeout(() => router.push("/login"), 3000);
    }
  };

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="w-full max-w-md text-center p-6 space-y-4">
          <p className="text-destructive font-medium">
            Некорректная ссылка сброса пароля.
          </p>
          <Button variant="outline" className="w-full">
            <Link href="/forgot-password">Запросить сброс повторно</Link>
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background">
      <Card className="w-full max-w-md shadow-lg border-border/60">
        <CardHeader className="text-center space-y-1">
          <CardTitle className="text-2xl font-bold">Новый пароль</CardTitle>
          <CardDescription>
            Придумайте и подтвердите новый пароль для аккаунта
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {error && (
            <div className="p-3 text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-md">
              {error}
            </div>
          )}

          {success ? (
            <div className="flex flex-col items-center justify-center space-y-3 py-4">
              <CheckCircle2 className="h-12 w-12 text-emerald-500" />
              <p className="text-sm text-emerald-600 font-medium text-center">
                {success}
              </p>
              <p className="text-xs text-muted-foreground">
                Перенаправление на страницу входа через 3 сек...
              </p>
              <Button className="w-full mt-2">
                <Link href="/login">Войти прямо сейчас</Link>
              </Button>
            </div>
          ) : (
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="password">Новый пароль</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="password"
                    type="password"
                    placeholder="••••••••"
                    className="pl-9"
                    disabled={isSubmitting}
                    {...register("password")}
                  />
                </div>
                {errors.password && (
                  <p className="text-xs text-destructive">
                    {errors.password.message}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirmPassword">
                  Подтвердите новый пароль
                </Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="confirmPassword"
                    type="password"
                    placeholder="••••••••"
                    className="pl-9"
                    disabled={isSubmitting}
                    {...register("confirmPassword")}
                  />
                </div>
                {errors.confirmPassword && (
                  <p className="text-xs text-destructive">
                    {errors.confirmPassword.message}
                  </p>
                )}
              </div>

              <Button
                type="submit"
                className="w-full h-11"
                disabled={isSubmitting}
              >
                {isSubmitting && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                Сохранить новый пароль
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
