/**
 * Auth configuration (NextAuth.js v5).
 *
 * Uses a simple credentials provider for internal teams.
 * The admin email/password is read from environment variables.
 * Extend with OAuth providers as needed.
 */
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";

export const {
  handlers,
  signIn,
  signOut,
  auth,
} = NextAuth({
  providers: [
    Credentials({
      name: "이메일/비밀번호",
      credentials: {
        email: { label: "이메일", type: "email" },
        password: { label: "비밀번호", type: "password" },
      },
      async authorize(credentials) {
        const adminEmail = process.env.ADMIN_EMAIL || "admin@example.com";
        const adminPassword = process.env.ADMIN_PASSWORD || "changeme";

        if (
          credentials?.email === adminEmail &&
          credentials?.password === adminPassword
        ) {
          return {
            id: "admin",
            email: adminEmail,
            name: "관리자",
          };
        }
        return null;
      },
    }),
  ],
  pages: {
    signIn: "/login",
  },
  session: {
    strategy: "jwt",
  },
  callbacks: {
    authorized() {
      // Auth disabled — allow all requests
      return true;
    },
  },
});

/**
 * Convenience helper for server components / route handlers
 * that need to gate access.
 */
export async function requireAuth() {
  const session = await auth();
  if (!session?.user) {
    throw new Error("인증이 필요합니다.");
  }
  return session;
}
