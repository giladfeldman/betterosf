import { describe, it, expect } from "vitest";
import { osfProvider } from "@/lib/auth/osf-provider";

describe("osfProvider", () => {
  const config = osfProvider({ clientId: "cid", clientSecret: "csecret" });

  it("uses OSF endpoints", () => {
    expect(config.id).toBe("osf");
    expect(config.name).toBe("OSF");
    expect(config.type).toBe("oauth");
    const authUrl =
      typeof config.authorization === "string"
        ? config.authorization
        : config.authorization?.url;
    expect(authUrl).toBe("https://accounts.osf.io/oauth2/authorize");
    expect(typeof config.token === "string" ? config.token : config.token?.url)
      .toBe("https://accounts.osf.io/oauth2/token");
    expect(typeof config.userinfo === "string" ? config.userinfo : config.userinfo?.url)
      .toBe("https://api.osf.io/v2/users/me/");
  });

  it("requests osf.full_read scope", () => {
    const scope =
      typeof config.authorization === "object"
        ? (config.authorization as { params?: { scope?: string } }).params?.scope
        : undefined;
    expect(scope).toBe("osf.full_read");
  });

  it("maps OSF userinfo payload to {id, name, email}", () => {
    const profile = config.profile?.(
      {
        data: {
          id: "abc12",
          type: "users",
          attributes: { full_name: "Ada Lovelace", email: "ada@example.com" },
        },
      },
      undefined as never
    );
    expect(profile).toMatchObject({ id: "abc12", name: "Ada Lovelace", email: "ada@example.com" });
  });

  it("tolerates missing email", () => {
    const profile = config.profile?.(
      { data: { id: "u1", type: "users", attributes: { full_name: "X" } } },
      undefined as never
    );
    expect(profile?.email).toBeNull();
  });
});
