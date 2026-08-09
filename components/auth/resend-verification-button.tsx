"use client";

import * as React from "react";
import { Loader2, MailCheck, RefreshCw } from "lucide-react";

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
import { resendVerificationEmail } from '@/app/(auth)/actions';

interface ResendVerificationProps {
  initialEmail?: string;
  variant?: "link" | "outline" | "default";
}

export function ResendVerificationButton({
  initialEmail = "",
  variant = "link",
}: ResendVerificationProps) {
  const [open, setOpen] = React.useState(false);
  const [email, setEmail] = React.useState(initialEmail);
  const [status, setStatus] = React.useState<{
    type: "success" | "error";
    msg: string;
  } | null>(null);
  const [isPending, startTransition] = React.useTransition();
  const [cooldown, setCooldown] = React.useState(0);

  // Таймер обратного отсчета
  React.useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => {
      setCooldown((prev) => prev - 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  const handleResend = (e: React.FormEvent) => {
    e.preventDefault();
    setStatus(null);

    startTransition(async () => {
      const res = await resendVerificationEmail(email);

      if (res.error) {
        setStatus({ type: "error", msg: res.error });
      } else if (res.success) {
        setStatus({ type: "success", msg: res.success });
        setCooldown(60); // Запускаем кулдаун на 60 секунд
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger>
        <Button variant={variant} className="text-xs p-0 h-auto font-normal">
          Не получили письмо? Отправить повторно
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MailCheck className="h-5 w-5 text-primary" />
            Повторная отправка письма
          </DialogTitle>
          <DialogDescription>
            Укажите свой Email, и мы отправим новую ссылку для подтверждения
            аккаунта.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleResend} className="space-y-4 pt-2">
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

          <div className="space-y-2">
            <Label htmlFor="resend-email">Email адресата</Label>
            <Input
              id="resend-email"
              type="email"
              placeholder="name@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={isPending || cooldown > 0}
              required
            />
          </div>

          <Button
            type="submit"
            className="w-full"
            disabled={isPending || cooldown > 0 || !email}
          >
            {isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Отправка...
              </>
            ) : cooldown > 0 ? (
              `Отправить повторно (${cooldown}с)`
            ) : (
              <>
                <RefreshCw className="mr-2 h-4 w-4" />
                Отправить ссылку
              </>
            )}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
