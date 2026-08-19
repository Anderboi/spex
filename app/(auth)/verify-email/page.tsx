"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Loader2, CheckCircle2, XCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { verifyEmailToken } from "../../../actions/auth";
import { ResendVerificationButton } from "@/components/auth/resend-verification-button";

export default function VerifyEmailPage() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState<string | null>(null);

  const onSubmit = React.useCallback(async () => {
    if (!token) {
      setError("Отсутствует токен верификации!");
      return;
    }

    const res = await verifyEmailToken(token);
    if (res.error) {
      setError(res.error);
    } else if (res.success) {
      setSuccess(res.success);
    }
  }, [token]);

  React.useEffect(() => {
    onSubmit();
  }, [onSubmit]);

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background">
      <Card className="w-full max-w-md text-center shadow-lg">
        <CardHeader>
          <CardTitle className="text-2xl font-bold">
            Подтверждение Email
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {!success && !error && (
            <div className="flex flex-col items-center justify-center space-y-2">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">
                Проверяем ваш токен...
              </p>
            </div>
          )}

          {success && (
            <div className="flex flex-col items-center justify-center space-y-3">
              <CheckCircle2 className="h-12 w-12 text-emerald-500" />
              <p className="text-sm text-emerald-600 font-medium">{success}</p>
              <Button className="w-full mt-4">
                <Link href="/login">Войти в аккаунт</Link>
              </Button>
            </div>
          )}

          {error && (
            <div className="flex flex-col items-center justify-center space-y-3">
              <XCircle className="h-12 w-12 text-destructive" />
              <p className="text-sm text-destructive font-medium">{error}</p>

              <div className="pt-2 w-full space-y-2">
                <ResendVerificationButton variant="outline" />
                <Button variant="ghost" className="w-full">
                  <Link href="/login">Вернуться к входу</Link>
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
