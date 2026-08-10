"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { AlertCircle, RotateCcw } from "lucide-react";

export default function ProjectsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[Projects Error Boundary]:", error);
  }, [error]);

  return (
    <div className="min-h-[400px] flex flex-col items-center justify-center text-center p-6 space-y-4 rounded-xl border border-border bg-card/50">
      <div className="p-3 bg-destructive/10 text-destructive rounded-full">
        <AlertCircle className="size-8" />
      </div>

      <div className="space-y-1 max-w-md">
        <h2 className="text-xl font-semibold tracking-tight">
          Не удалось загрузить проекты
        </h2>
        <p className="text-sm text-muted-foreground">
          {error.message ||
            "Произошла ошибка при обращении к базе данных. Попробуйте обновить страницу."}
        </p>
      </div>

      <Button onClick={() => reset()} variant="outline" className="gap-2">
        <RotateCcw className="size-4" />
        Попробовать снова
      </Button>
    </div>
  );
}
