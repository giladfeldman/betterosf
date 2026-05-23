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

export function osfProvider(opts: OAuthUserConfig<OsfProfile>): OAuth2Config<OsfProfile> {
  return {
    id: "osf",
    name: "OSF",
    type: "oauth",
    authorization: {
      url: "https://accounts.osf.io/oauth2/authorize",
      params: { scope: "osf.full_read" },
    },
    token: "https://accounts.osf.io/oauth2/token",
    userinfo: {
      url: "https://api.osf.io/v2/users/me/",
      request: async ({ tokens }: { tokens: { access_token?: string } }) => {
        const res = await fetch("https://api.osf.io/v2/users/me/", {
          headers: {
            Authorization: `Bearer ${tokens.access_token}`,
            Accept: "application/vnd.api+json",
          },
        });
        if (!res.ok) throw new Error(`OSF userinfo failed: ${res.status}`);
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
