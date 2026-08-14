import NextAuth from "next-auth";
import type { JWT } from "next-auth/jwt";
import type { Session } from "next-auth";
import { hasOsfWriteScope, osfProvider } from "@/lib/auth/osf-provider";
import { authEnv } from "@/lib/env";

declare module "next-auth" {
  interface Session {
    accessToken?: string;
    osfScope?: string;
    osfCanWrite?: boolean;
    osfUserId?: string;
    osfAccessTokenExpires?: number;
    osfAuthError?: "RefreshAccessTokenError" | "MissingRefreshToken";
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    accessToken?: string;
    refreshToken?: string;
    accessTokenExpires?: number;
    osfScope?: string;
    osfUserId?: string;
    osfAuthError?: "RefreshAccessTokenError" | "MissingRefreshToken";
  }
}

async function refreshOsfAccessToken(token: JWT): Promise<JWT> {
  if (!token.refreshToken) {
    return { ...token, osfAuthError: "MissingRefreshToken" };
  }

  try {
    const { AUTH_OSF_ID, AUTH_OSF_SECRET } = authEnv();
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: token.refreshToken,
      client_id: AUTH_OSF_ID,
      client_secret: AUTH_OSF_SECRET,
    });
    const res = await fetch("https://accounts.osf.io/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`OSF token refresh failed: ${res.status}`);
    const refreshed = await res.json() as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      scope?: string;
    };
    const expiresIn = typeof refreshed.expires_in === "number" ? refreshed.expires_in : 3600;
    return {
      ...token,
      accessToken: refreshed.access_token ?? token.accessToken,
      refreshToken: refreshed.refresh_token ?? token.refreshToken,
      accessTokenExpires: Date.now() + expiresIn * 1000,
      osfScope: refreshed.scope ?? token.osfScope,
      osfAuthError: undefined,
    };
  } catch {
    return { ...token, osfAuthError: "RefreshAccessTokenError" };
  }
}

// Fail fast at server startup if the OSF OAuth credentials are missing, so the
// failure is one clear message instead of a cryptic upstream OAuth error later.
// Skipped during `next build` (which never runs the OAuth flow and may not have
// the secrets in its env) and in tests (which mock `@/auth` and never load this).
if (
  process.env.NEXT_PHASE !== "phase-production-build" &&
  process.env.NODE_ENV !== "test" &&
  process.env.VITEST === undefined
) {
  authEnv();
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
        token.osfScope = account.scope;
        const osfProfile = profile as {
          data?: { id?: string; attributes?: { full_name?: string; email?: string } };
          id?: string;
          name?: string | null;
          email?: string | null;
        };
        // Auth.js may pass either raw OSF userinfo or the mapped profile().
        token.osfUserId = osfProfile.data?.id ?? osfProfile.id;
        if (token.osfUserId) {
          const { upsertOsfUser } = await import("@/lib/db/users");
          await upsertOsfUser({
            osfUserId: token.osfUserId,
            name: osfProfile.name ?? osfProfile.data?.attributes?.full_name ?? null,
            email: osfProfile.email ?? osfProfile.data?.attributes?.email ?? null,
          });
        }
        return token;
      }
      if (token.accessToken && token.accessTokenExpires && Date.now() < token.accessTokenExpires - 60_000) {
        return token;
      }
      if (token.accessToken) {
        // Access token expired (or within 60s of doing so) — refresh it.
        return refreshOsfAccessToken(token);
      }
      // No access token at all (e.g. a stale/empty JWT) — nothing to refresh.
      return token;
    },
    async session({ session, token }: { session: Session; token: JWT }) {
      session.accessToken = token.accessToken;
      session.osfScope = token.osfScope;
      session.osfCanWrite = hasOsfWriteScope(token.osfScope);
      session.osfUserId = token.osfUserId;
      session.osfAccessTokenExpires = token.accessTokenExpires;
      session.osfAuthError = token.osfAuthError;
      return session;
    },
  },
  pages: {
    signIn: "/login",
    // Auth.js's built-in error page renders "Server error — There is a problem with the
    // server configuration. Check the server logs for more information." The person
    // reading it cannot check the server logs, and "configuration" is the wrong cause for
    // most of what lands there: it is the catch-all for ANY server-side failure during the
    // callback, including OSF issuing a token and then refusing it. Ours says what is
    // actually known and what to do about it.
    error: "/auth/error",
  },
});
