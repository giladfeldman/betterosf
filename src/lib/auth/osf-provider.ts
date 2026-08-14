import type { OAuth2Config, OAuthUserConfig } from "next-auth/providers";

type OsfUserinfo = {
  data: {
    id: string;
    type: string;
    attributes: {
      full_name?: string;
      given_name?: string;
      family_name?: string;
      email?: string;
    };
  };
};

export type OsfProfile = OsfUserinfo;

export const OSF_READ_SCOPE = "osf.full_read";
export const OSF_WRITE_SCOPE = "osf.full_write";
export const OSF_UPLOAD_SCOPE = `${OSF_READ_SCOPE} ${OSF_WRITE_SCOPE}`;

export function hasOsfWriteScope(scope: string | undefined | null): boolean {
  return (scope ?? "").split(/\s+/).includes(OSF_WRITE_SCOPE);
}

export function osfProvider(opts: OAuthUserConfig<OsfProfile>): OAuth2Config<OsfProfile> {
  return {
    id: "osf",
    name: "OSF",
    type: "oauth",
    authorization: {
      url: "https://accounts.osf.io/oauth2/authorize",
      params: {
        scope: OSF_UPLOAD_SCOPE,
        // OSF only issues refresh tokens when access_type=offline (default is
        // online → access token only → ~hourly "Reconnect needed").
        access_type: "offline",
      },
    },
    token: "https://accounts.osf.io/oauth2/token",
    userinfo: {
      url: "https://api.osf.io/v2/users/me/",
      /**
       * Fetch the profile with the token OSF just issued.
       *
       * This is the step that fails when a sign-in dies AFTER the user has already
       * approved on osf.io: the code-for-token exchange succeeds, and then
       * `api.osf.io` rejects the brand-new token with a 401. Auth.js turns that into
       * a `CallbackRouteError` and redirects to `?error=Configuration`, which is a
       * misleading name — nothing about the configuration is wrong.
       *
       * Two things are deliberate here:
       *
       * 1. **The failure is described, not just counted.** The original threw
       *    `OSF userinfo failed: 401` and dropped everything that would explain it, so
       *    the server log said only that it happened. A 401 has several distinct causes
       *    and the response tells them apart: no token in the exchange result at all
       *    (our bug or a shape change), a token OSF has not activated yet, or a grant
       *    OSF refuses outright. The token itself is NEVER logged — only whether one
       *    arrived and how long it was.
       *
       * 2. **One retry on 401.** OSF's API is eventually consistent — this project has
       *    been bitten by that before — and a token that `accounts.osf.io` minted a
       *    moment ago can briefly not exist as far as `api.osf.io` is concerned. A
       *    single short retry costs one second on the unhappy path. It is NOT a
       *    blanket retry: it logs loudly when it rescues a sign-in, because "it works
       *    if you try twice" is a finding, not a fix.
       */
      request: async ({ tokens }: { tokens: { access_token?: string; scope?: string; token_type?: string } }) => {
        const token = tokens.access_token;

        // A missing token means the exchange returned a shape we did not expect. That
        // is our bug, not OSF's, and it must not be reported as an OSF 401 — which is
        // exactly what `Bearer undefined` would produce.
        if (!token) {
          console.error(
            "[osf-provider] the token exchange returned no access_token",
            JSON.stringify({ keys: Object.keys(tokens ?? {}), tokenType: tokens?.token_type ?? null }),
          );
          throw new Error(
            "OSF did not return an access token when signing in. This is a BetterOSF bug, not a problem with your OSF account.",
          );
        }

        const attempt = async () =>
          fetch("https://api.osf.io/v2/users/me/", {
            headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.api+json" },
            cache: "no-store",
          });

        let res = await attempt();

        if (res.status === 401) {
          await new Promise((r) => setTimeout(r, 1000));
          const retry = await attempt();
          if (retry.ok) {
            console.warn(
              "[osf-provider] /v2/users/me/ 401'd on a fresh token and succeeded on retry — OSF token propagation lag.",
            );
          }
          res = retry;
        }

        if (!res.ok) {
          const body = await res.text().catch(() => "");
          console.error(
            "[osf-provider] userinfo failed",
            JSON.stringify({
              status: res.status,
              // Length and presence only — never the credential.
              tokenLength: token.length,
              scope: tokens.scope ?? null,
              tokenType: tokens.token_type ?? null,
              body: body.slice(0, 400),
            }),
          );
          throw new Error(
            res.status === 401
              ? "OSF issued a token and then refused it. This usually clears in a minute — try signing in again. If it keeps happening, BetterOSF's OSF application may need re-authorising."
              : `OSF returned ${res.status} when reading your profile.`,
          );
        }

        return res.json();
      },
    },
    profile(profile) {
      const a = profile.data.attributes;
      const joined = [a.given_name, a.family_name].filter(Boolean).join(" ");
      const name = a.full_name ?? (joined.length > 0 ? joined : profile.data.id);
      return {
        id: profile.data.id,
        name: name || profile.data.id,
        email: a.email ?? null,
      };
    },
    options: opts,
  };
}
