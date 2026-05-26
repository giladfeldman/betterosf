import NextAuth from "next-auth";
import type { JWT } from "next-auth/jwt";
import type { Session } from "next-auth";
import { osfProvider } from "@/lib/auth/osf-provider";

declare module "next-auth" {
  interface Session {
    accessToken?: string;
    osfUserId?: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    accessToken?: string;
    refreshToken?: string;
    accessTokenExpires?: number;
    osfUserId?: string;
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  // Auth.js v5 requires this for non-Vercel hosts (localhost, custom domains).
  // Production on Vercel sets AUTH_URL via VERCEL_URL automatically; locally
  // we need to opt in explicitly or every auth() call throws UntrustedHost.
  trustHost: true,
  providers: [
    osfProvider({
      clientId: process.env.AUTH_OSF_ID ?? "",
      clientSecret: process.env.AUTH_OSF_SECRET ?? "",
    }),
  ],
  session: { strategy: "jwt", maxAge: 30 * 24 * 60 * 60 }, // 30 days sliding
  callbacks: {
    async jwt({ token, account, profile }) {
      // Initial sign in
      if (account && profile) {
        const expiresIn = typeof account.expires_in === "number" ? account.expires_in : 3600;
        token.accessToken = account.access_token;
        token.refreshToken = account.refresh_token;
        token.accessTokenExpires = Date.now() + expiresIn * 1000;
        token.osfUserId = (profile as { data?: { id?: string } }).data?.id;
        return token;
      }
      // Subsequent calls — return as-is. Refresh logic is not wired in v1 of Plan 3
      // because OSF refresh-token TTL semantics aren't documented; users re-auth after expiry.
      return token;
    },
    async session({ session, token }: { session: Session; token: JWT }) {
      session.accessToken = token.accessToken;
      session.osfUserId = token.osfUserId;
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
});
