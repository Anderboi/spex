import { acceptInvite } from '@/actions/teams';
import { Button } from "@/components/ui/button";
import { Building2, AlertCircle } from "lucide-react";
import Link from "next/link";

interface PageProps {
  searchParams: Promise<{ token?: string }>;
}

export default async function AcceptInvitePage({ searchParams }: PageProps) {
  const { token } = await searchParams;

  if (!token) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4">
        <AlertCircle className="size-12 text-destructive mb-4" />
        <h1 className="text-xl font-semibold mb-2">Неверная ссылка</h1>
        <p className="text-sm text-muted-foreground mb-4">
          Токен приглашения отсутствует.
        </p>
        <Button>
          <Link href="/">На главную</Link>
        </Button>
      </div>
    );
  }

  async function handleAccept(): Promise<void> {
    "use server";
    const res = await acceptInvite(token!);
    if (res?.error) {
      // При желании здесь можно пробросить ошибку или обработать редирект с query-параметром
      throw new Error(res.error);
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4">
      <div className="max-w-md w-full p-8 border rounded-xl shadow-sm text-center space-y-6 bg-card">
        <div className="p-4 bg-primary/10 text-primary rounded-full w-fit mx-auto">
          <Building2 className="size-8" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Вас пригласили в команду
          </h1>
          <p className="text-sm text-muted-foreground mt-2">
            Примите приглашение, чтобы получить доступ к проектам и материалам
            организации.
          </p>
        </div>

        <form action={handleAccept}>
          <Button type="submit" className="w-full size-lg">
            Принять и войти
          </Button>
        </form>
      </div>
    </div>
  );
}
