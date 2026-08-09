"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Mail, ArrowLeft } from "lucide-react";
import Link from "next/link";

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
import {
  ResetPasswordRequestInput,
  resetPasswordRequestSchema,
} from "@/lib/validations";
import { requestPasswordReset } from "../actions";

export default function ForgotPasswordPage() {
  const [status, setStatus] = React.useState<{
    type: "success" | "error";
    msg: string;
  } | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ResetPasswordRequestInput>({
    resolver: zodResolver(resetPasswordRequestSchema),
    defaultValues: { email: "" },
  });

  const onSubmit = async (data: ResetPasswordRequestInput) => {
    setStatus(null);
    const res = await requestPasswordReset(data);

    if (res.error) {
      setStatus({ type: "error", msg: res.error });
    } else if (res.success) {
      setStatus({ type: "success", msg: res.success });
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background">
      <Card className="w-full max-w-md shadow-lg border-border/60">
        <CardHeader className="text-center space-y-1">
          <CardTitle className="text-2xl font-bold">Забыли пароль?</CardTitle>
          <CardDescription>
            Укажите Email, связанный с вашим аккаунтом, и мы отправим ссылку для
            сброса.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {status && (
            <div
              className={`p-3 text-sm rounded-md border ${
                status.type === "error"
                  ? "text-destructive bg-destructive/10 border-destructive/20"
                  : "text-emerald-600 bg-emerald-50 border-emerald-200 dark:bg-emerald-950/30"
              }`}
            >
              {status.msg}
            </div>
          )}

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  id="email"
                  type="email"
                  placeholder="name@example.com"
                  className="pl-9"
                  disabled={isSubmitting}
                  {...register("email")}
                />
              </div>
              {errors.email && (
                <p className="text-xs text-destructive">
                  {errors.email.message}
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
              Отправить ссылку
            </Button>
          </form>
        </CardContent>

        <CardFooter className="justify-center border-t border-border/40 pt-4">
          <Link
            href="/login"
            className="flex items-center text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Вернуться к входу
          </Link>
        </CardFooter>
      </Card>
    </div>
  );
}
