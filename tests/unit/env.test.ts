import { describe, it, expect } from "vitest";
import { parseEnv, parseAuthEnv } from "@/lib/env";

describe("parseEnv", () => {
  it("parses a valid environment", () => {
    const env = parseEnv({
      OSF_APP_TOKEN: "abc123",
      NEXT_PUBLIC_BASE_URL: "http://localhost:4747",
    });
    expect(env.OSF_APP_TOKEN).toBe("abc123");
    expect(env.NEXT_PUBLIC_BASE_URL).toBe("http://localhost:4747");
  });

  it("throws when OSF_APP_TOKEN missing", () => {
    expect(() => parseEnv({ NEXT_PUBLIC_BASE_URL: "http://x" })).toThrow(/OSF_APP_TOKEN/);
  });

  it("throws when NEXT_PUBLIC_BASE_URL is not a URL", () => {
    expect(() => parseEnv({ OSF_APP_TOKEN: "x", NEXT_PUBLIC_BASE_URL: "not-a-url" })).toThrow();
  });
});

describe("parseAuthEnv", () => {
  it("parses valid OSF OAuth credentials", () => {
    const env = parseAuthEnv({ AUTH_OSF_ID: "id", AUTH_OSF_SECRET: "secret", AUTH_SECRET: "rand" });
    expect(env).toEqual({ AUTH_OSF_ID: "id", AUTH_OSF_SECRET: "secret", AUTH_SECRET: "rand" });
  });

  it("throws a message naming every missing var", () => {
    expect(() => parseAuthEnv({})).toThrow(/AUTH_OSF_ID/);
    expect(() => parseAuthEnv({ AUTH_OSF_ID: "id" })).toThrow(/AUTH_OSF_SECRET.*AUTH_SECRET|AUTH_SECRET.*AUTH_OSF_SECRET/);
  });

  it("rejects empty-string credentials", () => {
    expect(() => parseAuthEnv({ AUTH_OSF_ID: "", AUTH_OSF_SECRET: "s", AUTH_SECRET: "r" })).toThrow(/AUTH_OSF_ID/);
  });
});
