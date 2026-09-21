import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: DefaultSession["user"] & { role?: "ADMIN" | "SUBSCRIBER" };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role?: "ADMIN" | "SUBSCRIBER";
  }
}
