import NextAuth from "next-auth";
import { SupabaseAdapter } from "@auth/supabase-adapter";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { createClient } from "@supabase/supabase-js";
import { authConfig } from "../auth.config";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createAdminClient } from "./supabase/admin";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: SupabaseAdapter({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    secret: process.env.SUPABASE_SERVICE_ROLE_KEY!,
  }),
  session: { strategy: "jwt" }, // Важно: для Credentials используем JWT сессии
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
    }),
    Credentials({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        const email = credentials.email as string;
        const password = credentials.password as string;

        // 2. Поиск пользователя в Supabase
        const { data: user } = await supabaseAdmin
          .from("users")
          .select("*")
          .eq("email", email)
          .single();

        if (!user || !user.password) return null;

        // 3. Проверка совпадения хешей паролей
        const passwordsMatch = await bcrypt.compare(password, user.password);
        if (!passwordsMatch) return null;

        if (!user.email_verified) {
          throw new Error("EmailNotVerified");
        }

        return {
          id: user.id,
          name: user.name,
          email: user.email,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.id) {
        session.user.id = token.id as string;
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
});

interface RequireSessionOptions {
  allowNoOrg?: boolean;
}

export const requireSession = cache(async (options?: RequireSessionOptions) => {
  const session = await auth();

  if (!session?.user?.id) redirect("/login");

  const userId = session.user.id;
  const supabase = createAdminClient();

  const { data: user } = await supabase
    .from("users")
    .select("active_org_id")
    .eq("id", userId)
    .maybeSingle();

  let activeOrgId = user?.active_org_id ?? null;
  let userRole: string | null = null;

  if (activeOrgId) {
    // Получаем роль в активной организации
    const { data: member } = await supabase
      .from("organization_members")
      .select("role")
      .eq("user_id", userId)
      .eq("org_id", activeOrgId)
      .maybeSingle();

    if (member) {
      userRole = member.role;
    } else {
      // Если активной организации больше не существует в members, сбрасываем
      activeOrgId = null;
    }
  }

  if (!activeOrgId) {
    if (!options?.allowNoOrg) {
      redirect("/onboarding/create-org");
    }

    return {
      session,
      userId,
      orgId: null,
      role: null,
      user: session.user,
    };
  }

  if (options?.allowNoOrg) {
    redirect("/projects");
  }

  return {
    session,
    userId,
    orgId: activeOrgId,
    role: userRole,
    user: session.user,
  };
});
