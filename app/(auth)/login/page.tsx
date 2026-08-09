import { LoginForm } from "@/components/auth/login-form";

export default function LoginPage() {
  return (
    <div className="min-h-screen w-full flex items-center justify-center p-4 bg-bg relative overflow-hidden">
      {/* Декоративный градиентный фоновый элемент */}
      <div className="absolute -top-40 -right-40 w-96 h-96 bg-primary/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-primary/10 rounded-full blur-3xl pointer-events-none" />

      <main className="z-10 w-full flex justify-center">
        <LoginForm />
      </main>
    </div>
  );
}
