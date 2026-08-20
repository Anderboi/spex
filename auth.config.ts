import type { NextAuthConfig } from "next-auth";

export const authConfig = {
  pages: {
    signIn: "/login",
  },
  callbacks: {
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user;

      const PUBLIC_PREFIXES = [
        "/login",
        "/register",
        "/verify-email",
        "/forgot-password",
        "/reset-password",
        "/invite",
      ];
      const isPublicRoute =
        nextUrl.pathname === "/" ||
        PUBLIC_PREFIXES.some((p) => nextUrl.pathname.startsWith(p));

      const isAuthRoute =
        nextUrl.pathname.startsWith("/login") ||
        nextUrl.pathname.startsWith("/register");

      if (isAuthRoute && isLoggedIn) {
        return Response.redirect(new URL("/projects", nextUrl));
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
