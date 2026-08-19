import Link from "next/link";

export default function OrgNotFound() {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-3 p-6 text-center">
      <h1 className="text-xl font-semibold">Студия не найдена</h1>
      <p className="text-sm text-fg-muted">
        Возможно, она удалена или у вас нет к ней доступа.
      </p>
      <Link href="/projects" className="text-sm text-fg-brand hover:underline">
        Вернуться к своим проектам
      </Link>
    </div>
  );
}
