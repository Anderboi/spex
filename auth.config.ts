import type { NextAuthConfig } from "next-auth";

export const authConfig = {
  pages: {
    signIn: "/login",
  },
  callbacks: {
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user;

      const isPublicRoute =
        nextUrl.pathname.startsWith("/login") ||
        nextUrl.pathname.startsWith("/register") ||
        nextUrl.pathname.startsWith("/verify-email") ||
        nextUrl.pathname.startsWith("/forgot-password") ||
        nextUrl.pathname.startsWith("/reset-password") ||
        nextUrl.pathname === "/";

      const isAuthRoute =
        nextUrl.pathname.startsWith("/login") ||
        nextUrl.pathname.startsWith("/register");

      if (isAuthRoute) {
        if (isLoggedIn) {
          return Response.redirect(new URL("/projects", nextUrl));
        }
        return true;
      }

      if (!isPublicRoute && !isLoggedIn) {
        let callbackUrl = nextUrl.pathname;
        if (nextUrl.search) callbackUrl += nextUrl.search;

        const encodedCallbackUrl = encodeURIComponent(callbackUrl);
        return Response.redirect(
          new URL(`/login?callbackUrl=${encodedCallbackUrl}`, nextUrl),
        );
      }

      return true;
    },
  },
  providers: [], // Провайдеры заполняются в основном auth.ts
} satisfies NextAuthConfig;
