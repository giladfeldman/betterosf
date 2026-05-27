import { env } from "@/lib/env";

/**
 * Returns the OSF API token to use for this request.
 * If a user is signed in via Auth.js, use their OAuth access token.
 * Otherwise fall back to the app-owned PAT (env var).
 */
export async function selectToken(): Promise<string> {
  try {
    const { auth } = await import("@/auth");
    const session = await auth();
    if (session?.accessToken) return session.accessToken;
  } catch {
    // auth() can throw in some non-request contexts (build, scripts) — fall through to app token
  }
  return env().OSF_APP_TOKEN;
}
