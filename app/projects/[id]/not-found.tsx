import Link from "next/link";
import { Button } from "@/components/ui/button";
import { FolderX, ArrowLeft } from "lucide-react";

export default function ProjectNotFound() {
  return (
    <div className="min-h-[500px] flex flex-col items-center justify-center text-center p-6 space-y-4">
      <div className="p-4 bg-muted/50 rounded-full border border-border">
        <FolderX className="size-10 text-muted-foreground" />
      </div>

      <div className="space-y-1 max-w-md">
        <h2 className="text-2xl font-bold tracking-tight">Проект не найден</h2>
        <p className="text-sm text-muted-foreground">
          Запрашиваемый проект не существует, был удален или у вас нет прав на
          его просмотр.
        </p>
      </div>

      <Button variant="default" className="gap-2">
        <Link href="/projects">
          <ArrowLeft className="size-4" /> К списку проектов
        </Link>
      </Button>
    </div>
  );
}
