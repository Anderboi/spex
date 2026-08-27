import NextAuth from "next-auth";
import { authConfig } from "./auth.config";

const { auth: middleware } = NextAuth(authConfig);

export default middleware;

export const config = {
  matcher: ["/((?!api|share|_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
