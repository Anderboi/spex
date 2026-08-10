import Link from "next/link";
import { Button } from "@/components/ui/button";
import { UserX, ArrowLeft } from "lucide-react";

export default function ContactNotFound() {
  return (
    <div className="min-h-[500px] flex flex-col items-center justify-center text-center p-6 space-y-4">
      <div className="p-4 bg-muted/50 rounded-full border border-border">
        <UserX className="size-10 text-fg" />
      </div>

      <div className="space-y-1 max-w-md">
        <h2 className="text-2xl font-bold tracking-tight">
          Контрагент не найден
        </h2>
        <p className="text-sm text-fg">
          Компания или контактное лицо с указанным ID не найдено.
        </p>
      </div>

      <Button variant="default" className="gap-2">
        <Link href="/contacts">
          <ArrowLeft className="size-4" /> Вернуться к списку контактов
        </Link>
      </Button>
    </div>
  );
}
