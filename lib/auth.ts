import type { AuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";

// A valid bcrypt hash of an arbitrary constant, compared against when no
// account matches the email. Without this, an unknown email returns from
// `authorize` before ever calling bcrypt.compare, while a known email with
// a wrong password always calls it — a measurable timing difference an
// attacker can use to enumerate which emails have accounts, entirely
// independent of the actual login attempt succeeding or failing.
const DUMMY_HASH = "$2a$10$D9dE01KqVmMAizvUyCltz.yB5G210EGvxW79ZAgg1PCvYkHh.t8N.";

export const authOptions: AuthOptions = {
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
  },
  providers: [
    CredentialsProvider({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        // Keyed by email (not IP — NextAuth's internal req here doesn't reliably
        // carry proxy headers) to slow down credential-stuffing against one account.
        const { ok } = rateLimit(`login:${credentials.email.toLowerCase()}`, 10, 10 * 60 * 1000);
        if (!ok) throw new Error("Too many login attempts. Try again in a few minutes.");

        const user = await db.user.findUnique({
          where: { email: credentials.email.toLowerCase() },
        });

        const valid = await bcrypt.compare(credentials.password, user?.passwordHash ?? DUMMY_HASH);
        if (!user || !valid) return null;

        return { id: user.id, email: user.email, name: user.name ?? user.email };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) token.id = user.id;
      return token;
    },
    async session({ session, token }) {
      if (session.user) (session.user as { id?: string }).id = token.id as string;
      return session;
    },
  },
};
