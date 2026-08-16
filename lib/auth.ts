import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { authConfig } from "../auth.config";
import { createAdminClient } from "./supabase/admin";

async function resolveOAuthUser(params: {
  email: string;
  name?: string | null;
  image?: string | null;
  provider: string;
  providerAccountId: string;
  account: Record<string, unknown>;
}): Promise<string | null> {
  const supabase = createAdminClient();
  const email = params.email.toLowerCase().trim();

  // 1. уже есть аккаунт этого провайдера?
  const { data: linked } = await supabase
    .from("accounts")
    .select("user_id")
    .eq("provider", params.provider)
    .eq("provider_account_id", params.providerAccountId)
    .maybeSingle();

  if (linked?.user_id) return linked.user_id as string;

  // 2. есть пользователь с таким email? связываем
  const { data: existing } = await supabase
    .from("users")
    .select("id, name, image")
    .eq("email", email)
    .maybeSingle();

  let userId = existing?.id as string | undefined;

  // 3. нет — создаём
  if (!userId) {
    const { data: created, error } = await supabase
      .from("users")
      .insert({
        email,
        name: params.name ?? email.split("@")[0],
        image: params.image ?? null,
        email_verified: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (error || !created) {
      console.error("[resolveOAuthUser] insert user", error?.message);
      return null;
    }
    userId = created.id as string;
  }
  // 4. связываем провайдера с пользователем
  const { error: linkError } = await supabase.from("accounts").upsert(
    {
      user_id: userId,
      type: "oauth",
      provider: params.provider,
      provider_account_id: params.providerAccountId,
      access_token: (params.account.access_token as string) ?? null,
      refresh_token: (params.account.refresh_token as string) ?? null,
      expires_at: (params.account.expires_at as number) ?? null, // bigint — число, не строка
      token_type: (params.account.token_type as string) ?? null,
      scope: (params.account.scope as string) ?? null,
      id_token: (params.account.id_token as string) ?? null,
    },
    { onConflict: "provider,provider_account_id" },
  );

  if (linkError)
    console.error("[resolveOAuthUser] insert account", linkError.message);

  // 5. личная студия — если пользователь ещё нигде не состоит
  const { error: orgError } = await supabase.rpc("ensure_personal_org", {
    p_user_id: userId,
  });
  if (orgError)
    console.error("[resolveOAuthUser] ensure_personal_org", orgError.message);

  return userId;
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  session: { strategy: "jwt" },
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID!,
      clientSecret: process.env.AUTH_GOOGLE_SECRET!,
      allowDangerousEmailAccountLinking: true,
    }),
    Credentials({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        const email = String(credentials.email).toLowerCase().trim();
        const supabase = createAdminClient();

        // 2. Поиск пользователя в Supabase
        const { data: user } = await supabase
          .from("users")
          .select("id, name, email, password, email_verified")
          .eq("email", email)
          .maybeSingle();

        if (!user?.password) return null;

        const ok = await bcrypt.compare(
          String(credentials.password),
          user.password,
        );
        if (!ok) return null;

        if (!user.email_verified) throw new Error("EmailNotVerified");

        return { id: user.id, name: user.name, email: user.email };
      },
    }),
  ],
  callbacks: {
    async signIn({ account, profile }) {
     
      if (account?.provider === "google") {
        if (!profile?.email) {
          console.warn("[signIn] отказ: нет email в profile");
          return false;
        }
        const verified = profile.email_verified;
        if (verified === false) {
          console.warn("[signIn] отказ: email не подтверждён у Google");
          return false;
        }
      }
      return true;
    },
    async jwt({ token, user, account, profile }) {
      // OAuth: подменяем provider-id на НАШ uuid
      if (account && account.provider !== "credentials" && profile?.email) {
        const id = await resolveOAuthUser({
          email: profile.email as string,
          name: (profile.name as string) ?? null,
          image: (profile.picture as string) ?? null,
          provider: account.provider,
          providerAccountId: account.providerAccountId,
          account: account as Record<string, unknown>,
        });
        if (id) token.id = id;
        return token;
      }

      if (user?.id) token.id = user.id;
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.id) session.user.id = token.id as string;
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
});

/** @deprecated используйте requireOrg() или requireNoOrg() */
export async function requireSession(options?: { allowNoOrg?: boolean }) {
  const { requireOrg, requireNoOrg } = await import("@/lib/auth/session");
  return options?.allowNoOrg ? requireNoOrg() : requireOrg();
}

// export const requireSession = cache(
//   async (options?: RequireSessionOptions) => {
//     const session = await auth();

//     console.log(
//       "[rs] session.user.id =",
//       session?.user?.id,
//       "| allowNoOrg =",
//       options?.allowNoOrg,
//     );

//     if (!session?.user?.id) {
//       console.log("[rs] → /login (нет сессии)");
//       redirect("/login");
//     }

//     const userId = session.user.id;
//     const supabase = createAdminClient();

//     const { data: user } = await supabase
//       .from("users")
//       .select("active_org_id")
//       .eq("id", userId)
//       .maybeSingle();

//     let activeOrgId = user?.active_org_id ?? null;
//     let userRole: string | null = null;

//     if (activeOrgId) {
//       // Получаем роль в активной организации
//       const { data: member } = await supabase
//         .from("organization_members")
//         .select("role")
//         .eq("user_id", userId)
//         .eq("org_id", activeOrgId)
//         .maybeSingle();

//       if (member) {
//         userRole = member.role;
//       } else {
//         // Если активной организации больше не существует в members, сбрасываем
//         activeOrgId = null;
//       }
//     }

//     console.log(
//       "[rs] active_org_id =",
//       user?.active_org_id,
//       "| role =",
//       userRole,
//     );

//     if (!activeOrgId) {
//       if (!options?.allowNoOrg) {
//         console.log("[rs] → /onboarding/create-org");
//         redirect("/onboarding/create-org");
//       }
//       console.log("[rs] возвращаю orgId=null");
//       return { session, userId, orgId: null, role: null, user: session.user };
//     }

//     return {
//       session,
//       userId,
//       orgId: activeOrgId,
//       role: userRole,
//       user: session.user,
//     };
//   },

//   // return {
//   //   session,
//   //   userId,
//   //   orgId: activeOrgId,
//   //   role: userRole,
//   //   user: session.user,
//   // };
//   // }
// );
