// Which Zenodo instance the toolkit talks to, and the credentials for it.
//
// Sandbox issues throwaway 10.5072 DOIs and can be wiped at any time. Production mints
// REAL, permanent DOIs against a researcher's name and cannot be undone. OAuth
// applications are registered SEPARATELY per instance, so the two credential pairs are
// not interchangeable — pointing one at the other fails at the authorize step with an
// unhelpful error.
//
// Two deliberate choices, both about failing in the safe direction:
//
//   1. Unset ZENODO_ENV means SANDBOX. Forgetting to configure this can never cause a
//      real DOI to be minted. (This is a documented default, not a silent fallback.)
//   2. An unrecognised ZENODO_ENV THROWS. "prod" is the obvious typo, and quietly
//      reading it as sandbox would send a real deposit to a wipeable instance.
//
// Client-safe (no `server-only`) for the env NAME and API base, which the browser needs
// in order to call Zenodo directly. `zenodoOAuthCredentials` reads secrets and must only
// ever be called from a server route — the client secret never reaches the browser.

export type ZenodoEnv = "sandbox" | "production";

/** OAuth scopes: write a deposit, and publish/edit it. Nothing broader. */
export const ZENODO_SCOPES = "deposit:write deposit:actions";

const API_BASES: Record<ZenodoEnv, string> = {
  sandbox: "https://sandbox.zenodo.org/api",
  production: "https://zenodo.org/api",
};

const OAUTH_VARS: Record<ZenodoEnv, { id: string; secret: string }> = {
  sandbox: { id: "ZENODO_SANDBOX_CLIENT_ID", secret: "ZENODO_SANDBOX_CLIENT_SECRET" },
  production: { id: "ZENODO_CLIENT_ID", secret: "ZENODO_CLIENT_SECRET" },
};

export function parseZenodoEnv(input: Record<string, string | undefined>): ZenodoEnv {
  const raw = input.ZENODO_ENV?.trim().toLowerCase();
  if (!raw) return "sandbox";
  if (raw === "sandbox" || raw === "production") return raw;
  throw new Error(
    `ZENODO_ENV must be "sandbox" or "production" (got ${JSON.stringify(input.ZENODO_ENV)}). ` +
      `Leave it unset for sandbox. Set it to "production" only when you intend to mint REAL DOIs.`,
  );
}

/** The active environment, from process.env. */
export function zenodoEnv(): ZenodoEnv {
  return parseZenodoEnv(process.env as Record<string, string | undefined>);
}

/** API base for an environment. No trailing slash — callers append `/records` etc. */
export function zenodoApiBase(env: ZenodoEnv): string {
  return API_BASES[env];
}

/** Human-readable host, for UI that has to tell the user where a deposit is going. */
export function zenodoSiteUrl(env: ZenodoEnv): string {
  return env === "sandbox" ? "https://sandbox.zenodo.org" : "https://zenodo.org";
}

export type ZenodoOAuthCredentials = { clientId: string; clientSecret: string };

/**
 * OAuth credentials for the active environment.
 *
 * Server-only in practice. Reads ONLY that environment's variables — there is
 * deliberately no cross-environment fallback, because the failure it would cause
 * (production credentials silently used against sandbox) is opaque and slow to debug.
 * A missing or blank value names the exact variable to set.
 */
export function zenodoOAuthCredentials(
  env: ZenodoEnv,
  input: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
): ZenodoOAuthCredentials {
  const vars = OAUTH_VARS[env];
  const clientId = input[vars.id]?.trim();
  const clientSecret = input[vars.secret]?.trim();

  const missing = [!clientId && vars.id, !clientSecret && vars.secret].filter(Boolean);
  if (missing.length > 0) {
    throw new Error(
      `Zenodo OAuth is not configured for the "${env}" environment: missing ${missing.join(", ")}. ` +
        `Register an application at ${zenodoSiteUrl(env)}/account/settings/applications/ ` +
        `with scopes "${ZENODO_SCOPES}", then set the values in .env.local (local) or the ` +
        `Vercel project settings (deploy). Credentials are NOT shared between sandbox and production.`,
    );
  }

  return { clientId: clientId!, clientSecret: clientSecret! };
}
