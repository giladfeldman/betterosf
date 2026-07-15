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
