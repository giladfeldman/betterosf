import { z } from "zod";

const schema = z.object({
  OSF_APP_TOKEN: z.string().min(1, "OSF_APP_TOKEN required"),
  NEXT_PUBLIC_BASE_URL: z.string().url(),
});

export type Env = z.infer<typeof schema>;

export function parseEnv(input: Record<string, string | undefined>): Env {
  return schema.parse(input);
}

let cached: Env | null = null;
export function env(): Env {
  if (cached) return cached;
  cached = parseEnv(process.env);
  return cached;
}

/**
 * Auth/OAuth secrets needed by the OSF sign-in + token-refresh flow.
 *
 * Kept SEPARATE from `env()` on purpose: anonymous request paths only need
 * `OSF_APP_TOKEN` (via `selectToken()`), so they must not fail just because the
 * OAuth credentials are absent. These are validated lazily — the first time an
 * actual OSF sign-in or token refresh runs — so a missing var produces ONE clear,
 * actionable error instead of a cryptic upstream OAuth failure, without breaking
 * `next build` (which never exercises the OAuth flow).
 */
const authSchema = z.object({
  AUTH_OSF_ID: z.string().min(1, "AUTH_OSF_ID required"),
  AUTH_OSF_SECRET: z.string().min(1, "AUTH_OSF_SECRET required"),
  AUTH_SECRET: z.string().min(1, "AUTH_SECRET required"),
});

export type AuthEnv = z.infer<typeof authSchema>;

export function parseAuthEnv(input: Record<string, string | undefined>): AuthEnv {
  const result = authSchema.safeParse(input);
  if (!result.success) {
    const missing = result.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(
      `BetterOSF is missing required OSF OAuth environment variables: ${missing}. ` +
        `Set them in .env.local (local) or the Vercel project settings (deploy). See .env.example.`
    );
  }
  return result.data;
}

let authCached: AuthEnv | null = null;
export function authEnv(): AuthEnv {
  if (authCached) return authCached;
  authCached = parseAuthEnv(process.env);
  return authCached;
}
