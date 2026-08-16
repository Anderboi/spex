import { LoginForm } from "@/components/auth/login-form";
import { Suspense } from "react";

export const metadata = { title: "Вход" };

export default function LoginPage() {
  return (
    <div className="min-h-svh w-full flex items-center justify-center p-4 bg-bg relative overflow-hidden">
      {/* Декоративный градиентный фоновый элемент */}
      {/* <div className="absolute -top-40 -right-40 w-96 h-96 bg-primary/10 rounded-full blur-3xl pointer-events-none" /> */}
      {/* <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-primary/10 rounded-full blur-3xl pointer-events-none" /> */}

      <Suspense
        fallback={
          <div className="h-130 w-full max-w-md animate-pulse rounded-xl bg-muted" />
        }
      >
        <LoginForm />
      </Suspense>
    </div>
  );
}
