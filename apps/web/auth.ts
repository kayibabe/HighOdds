import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Resend from "next-auth/providers/resend";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { verify } from "@node-rs/argon2";
import { db } from "@highodds/db";

export const { handlers, auth, signIn, signOut } = NextAuth({
  // Railway (like most PaaS reverse proxies) terminates TLS and forwards the original host via
  // X-Forwarded-Host; Auth.js v5 rejects that by default (UntrustedHost) unless explicitly told
  // to trust it. Safe here because Railway's edge is the only thing that can set that header for
  // traffic reaching this container.
  trustHost: true,
  adapter: PrismaAdapter(db),
  session: { strategy: "jwt" },
  providers: [
    Resend({ apiKey: process.env.AUTH_RESEND_KEY, from: process.env.EMAIL_FROM }),
    Credentials({
      name: "Admin password",
      credentials: { email: { label: "Email", type: "email" }, password: { label: "Password", type: "password" } },
      async authorize(credentials) {
        const email = String(credentials.email ?? "").toLowerCase();
        const password = String(credentials.password ?? "");
        const credential = await db.adminCredential.findUnique({ where: { email } });
        if (!credential || !(await verify(credential.passwordHash, password))) return null;
        const user = await db.user.findUnique({ where: { email } });
        return user && user.role === "ADMIN" ? { id: user.id, email: user.email, role: user.role } : null;
      }
    })
  ],
  callbacks: {
    async signIn({ user }) {
      const persisted = user.email ? await db.user.findUnique({ where: { email: user.email } }) : null;
      return persisted?.role === "ADMIN" || (persisted?.activeTo !== null && persisted?.activeTo !== undefined && persisted.activeTo > new Date());
    },
    async jwt({ token, user }) {
      const email = user?.email ?? token.email;
      if (email) {
        const persisted = await db.user.findUnique({ where: { email } });
        token.role = persisted?.role;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) session.user.role = token.role as "ADMIN" | "SUBSCRIBER" | undefined;
      return session;
    }
  },
  pages: { signIn: "/signin" }
});
