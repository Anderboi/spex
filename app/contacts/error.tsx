"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { AlertTriangle, RefreshCw } from "lucide-react";

export default function ContactsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Можно логировать ошибку в Sentry / LogRocket
    console.error("Ошибка при загрузке контактов:", error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center px-4">
      <div className="flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive mb-4">
        <AlertTriangle className="size-6" />
      </div>
      <h2 className="font-serif text-xl font-semibold text-fg">
        Не удалось загрузить контакты
      </h2>
      <p className="mt-2 text-sm text-fg-muted max-w-md">
        Произошла ошибка при получении данных с сервера. Попробуйте обновить
        страницу.
      </p>
      <Button onClick={() => reset()} className="mt-6 gap-2" variant="outline">
        <RefreshCw className="size-4" /> Повторить попытку
      </Button>
    </div>
  );
}
