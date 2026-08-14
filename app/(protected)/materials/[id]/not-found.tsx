import Link from "next/link";
import { Button } from "@/components/ui/button";
import { PackageX, ArrowLeft } from "lucide-react";

export default function MaterialNotFound() {
  return (
    <div className="min-h-[500px] flex flex-col items-center justify-center text-center p-6 space-y-4">
      <div className="p-4 bg-muted/50 rounded-full border border-border">
        <PackageX className="size-10 text-muted-foreground" />
      </div>

      <div className="space-y-1 max-w-md">
        <h2 className="text-2xl font-bold tracking-tight">
          Материал не найден
        </h2>
        <p className="text-sm text-muted-foreground">
          Позиция не найдена в базе данных. Возможно, материал был удален из
          библиотеки.
        </p>
      </div>

      <Button variant="default" className="gap-2">
        <Link href="/materials">
          <ArrowLeft className="size-4" /> Вернуться в библиотеку
        </Link>
      </Button>
    </div>
  );
}
