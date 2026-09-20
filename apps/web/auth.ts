import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Resend from "next-auth/providers/resend";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { verify } from "@node-rs/argon2";
import { db } from "@highodds/db";

export const { handlers, auth, signIn, signOut } = NextAuth({
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
      if (user?.email) {
        const persisted = await db.user.findUnique({ where: { email: user.email } });
        token.role = persisted?.role;
      }
      return token;
    }
  },
  pages: { signIn: "/signin" }
});
