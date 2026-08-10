"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { AlertTriangle, RefreshCw } from "lucide-react";

export default function MaterialsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[Materials Error Boundary]:", error);
  }, [error]);

  return (
    <div className="min-h-[400px] flex flex-col items-center justify-center text-center p-6 space-y-4 rounded-xl border border-border bg-card/50">
      <div className="p-3 bg-destructive/10 text-destructive rounded-full">
        <AlertTriangle className="size-8" />
      </div>

      <div className="space-y-1 max-w-md">
        <h2 className="text-xl font-semibold tracking-tight">
          Ошибка библиотеки материалов
        </h2>
        <p className="text-sm text-muted-foreground">
          {error.message ||
            "Не удалось получить список материалов. Проверьте соединение с сетью."}
        </p>
      </div>

      <Button onClick={() => reset()} variant="outline" className="gap-2">
        <RefreshCw className="size-4" />
        Повторить запрос
      </Button>
    </div>
  );
}
