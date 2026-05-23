import { describe, it, expect } from "vitest";
import { parseEnv } from "@/lib/env";

describe("parseEnv", () => {
  it("parses a valid environment", () => {
    const env = parseEnv({
      OSF_APP_TOKEN: "abc123",
      NEXT_PUBLIC_BASE_URL: "http://localhost:3000",
    });
    expect(env.OSF_APP_TOKEN).toBe("abc123");
    expect(env.NEXT_PUBLIC_BASE_URL).toBe("http://localhost:3000");
  });

  it("throws when OSF_APP_TOKEN missing", () => {
    expect(() => parseEnv({ NEXT_PUBLIC_BASE_URL: "http://x" })).toThrow(/OSF_APP_TOKEN/);
  });

  it("throws when NEXT_PUBLIC_BASE_URL is not a URL", () => {
    expect(() => parseEnv({ OSF_APP_TOKEN: "x", NEXT_PUBLIC_BASE_URL: "not-a-url" })).toThrow();
  });
});
