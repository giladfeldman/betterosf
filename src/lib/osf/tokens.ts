import "server-only";

/**
 * Returns the signed-in visitor's OWN OSF token, or "" for an anonymous visitor.
 *
 * Never the app-owned token (d-ff4462, 2026-11-18). The app token belonged to a real
 * OSF account that is a contributor on 104 private projects (measured that day with
 * `GET /v2/users/me/nodes/?filter[public]=false`). Sending it on behalf of a signed-out
 * visitor let any visitor who knew a private project's GUID or file URL read it through
 * the download proxy and the ZIP routes. An anonymous visitor must get exactly what OSF
 * gives an anonymous request: public content only. Callers send no Authorization header
 * when this returns "".
 *
 * A session whose refresh failed (`osfAuthError`) is treated as anonymous: its token is
 * stale and OSF would refuse it anyway.
 */
export async function userTokenOrAnonymous(): Promise<string> {
  try {
    const { auth } = await import("@/auth");
    const session = await auth();
    if (session?.accessToken && !session.osfAuthError) return session.accessToken;
  } catch {
    // auth() can throw in non-request contexts (build, scripts): anonymous.
  }
  return "";
}

/** Authorization header for a token from `userTokenOrAnonymous()`; none when anonymous. */
export function bearerOrNone(token: string): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}
