// The sealed Zenodo credential cookie.
//
// This cookie is a deposit credential for a third-party archive. Every test below is a
// way it could be accepted when it should not be: forged, replayed into another account,
// pointed at the wrong Zenodo instance, or used after it expired. All four fail closed.

import { describe, it, expect, beforeAll } from "vitest";

beforeAll(() => {
  process.env.AUTH_SECRET = "test-auth-secret-for-sealing-cookies";
});

const load = async () => await import("@/lib/transition/zenodo-session");

const base = {
  accessToken: "zen-token-123",
  env: "sandbox" as const,
  scope: "deposit:write deposit:actions",
  expiresAt: null,
  osfUserId: "osf-1",
};

describe("seal / open", () => {
  it("round-trips a value", async () => {
    const { seal, open } = await load();
    expect(open(seal(base))).toEqual(base);
  });

  it("does not leave the token readable in the cookie value", async () => {
    const { seal } = await load();
    expect(seal(base)).not.toContain("zen-token-123");
  });

  it("rejects a tampered ciphertext instead of returning partial data", async () => {
    const { seal, open } = await load();
    const sealed = seal(base);
    const parts = sealed.split(".");
    // Flip a byte in the ciphertext. GCM's tag is what catches this.
    const cipher = Buffer.from(parts[3]!, "base64url");
    cipher[0] = cipher[0]! ^ 0xff;
    parts[3] = cipher.toString("base64url");
    expect(open(parts.join("."))).toBeNull();
  });

  it("rejects an unknown format version rather than guessing", async () => {
    const { seal, open } = await load();
    const sealed = seal(base).replace(/^v1\./, "v2.");
    expect(open(sealed)).toBeNull();
  });

  it("returns null for absent, empty and malformed values", async () => {
    const { open } = await load();
    expect(open(undefined)).toBeNull();
    expect(open("")).toBeNull();
    expect(open("nonsense")).toBeNull();
    expect(open("v1.a.b")).toBeNull();
  });
});

describe("readZenodoSession", () => {
  const now = new Date("2026-08-13T12:00:00Z");

  it("accepts a session that matches on every axis", async () => {
    const { seal, readZenodoSession } = await load();
    const session = readZenodoSession(seal(base), { osfUserId: "osf-1", env: "sandbox", now });
    expect(session?.accessToken).toBe("zen-token-123");
  });

  it("refuses a cookie issued for a different OSF user", async () => {
    // Without this, a captured cookie keeps working after signing in as somebody else,
    // and the deposit lands in the wrong Zenodo account.
    const { seal, readZenodoSession } = await load();
    expect(readZenodoSession(seal(base), { osfUserId: "osf-2", env: "sandbox", now })).toBeNull();
  });

  it("refuses a sandbox token when the deployment is pointed at production", async () => {
    const { seal, readZenodoSession } = await load();
    expect(readZenodoSession(seal(base), { osfUserId: "osf-1", env: "production", now })).toBeNull();
  });

  it("refuses an expired token", async () => {
    const { seal, readZenodoSession } = await load();
    const expired = { ...base, expiresAt: now.getTime() - 1 };
    expect(readZenodoSession(seal(expired), { osfUserId: "osf-1", env: "sandbox", now })).toBeNull();
  });

  it("accepts a token whose expiry is still ahead", async () => {
    const { seal, readZenodoSession } = await load();
    const live = { ...base, expiresAt: now.getTime() + 60_000 };
    expect(readZenodoSession(seal(live), { osfUserId: "osf-1", env: "sandbox", now })).not.toBeNull();
  });

  it("refuses a session sealed with an empty token", async () => {
    const { seal, readZenodoSession } = await load();
    const blank = { ...base, accessToken: "" };
    expect(readZenodoSession(seal(blank), { osfUserId: "osf-1", env: "sandbox", now })).toBeNull();
  });
});

describe("safeReturnTo", () => {
  it("keeps a same-origin path", async () => {
    const { safeReturnTo } = await load();
    expect(safeReturnTo("/transition/abc12", "/transition")).toBe("/transition/abc12");
  });

  it("rejects a protocol-relative URL, which startsWith('/') would accept", async () => {
    // The v1.7.0 feedback bug in miniature: `//evil.example` starts with a slash and is a
    // URL to another host.
    const { safeReturnTo } = await load();
    expect(safeReturnTo("//evil.example/steal", "/transition")).toBe("/transition");
    expect(safeReturnTo("/\\evil.example", "/transition")).toBe("/transition");
  });

  it("rejects an absolute URL and an empty value", async () => {
    const { safeReturnTo } = await load();
    expect(safeReturnTo("https://evil.example", "/transition")).toBe("/transition");
    expect(safeReturnTo(null, "/transition")).toBe("/transition");
    expect(safeReturnTo("", "/transition")).toBe("/transition");
  });
});

describe("stateMatches", () => {
  it("matches an identical state and nothing else", async () => {
    const { stateMatches, newOAuthState } = await load();
    const s = newOAuthState();
    expect(stateMatches(s, s)).toBe(true);
    expect(stateMatches(s, `${s}x`)).toBe(false);
    expect(stateMatches("", "")).toBe(false);
  });

  it("produces a fresh, long state each time", async () => {
    const { newOAuthState } = await load();
    const a = newOAuthState();
    const b = newOAuthState();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThan(30);
  });
});

describe("readZenodoSession — malformed expiry (Codex review, 2026-08-13)", () => {
  const now = new Date("2026-08-13T12:00:00Z");

  it("refuses a non-numeric expiry rather than reading it as 'never expires'", async () => {
    // `"soon" <= now` is FALSE, so an unparseable expiry sailed through the live check and
    // the token was treated as valid forever.
    const { seal, readZenodoSession } = await load();
    for (const bad of ["soon", undefined, {}, true]) {
      const sealed = seal({ ...base, expiresAt: bad });
      expect(readZenodoSession(sealed, { osfUserId: "osf-1", env: "sandbox", now })).toBeNull();
    }
  });

  it("reads a NaN expiry as unknown, because JSON has already turned it into null", async () => {
    // Documenting the boundary rather than asserting something false: the cookie is JSON,
    // and `JSON.stringify(NaN)` is `null`. A NaN can therefore never reach the reader as
    // NaN — it arrives indistinguishable from "Zenodo did not say".
    const { seal, open } = await load();
    expect(open<{ expiresAt: unknown }>(seal({ ...base, expiresAt: Number.NaN }))?.expiresAt).toBeNull();
  });

  it("still accepts an explicitly unknown expiry", async () => {
    // Zenodo declining to say is a real answer, and different from a corrupt value.
    const { seal, readZenodoSession } = await load();
    const sealed = seal({ ...base, expiresAt: null });
    expect(readZenodoSession(sealed, { osfUserId: "osf-1", env: "sandbox", now })).not.toBeNull();
  });
});
