// Which Zenodo are we talking to?
//
// Sandbox issues throwaway 10.5072 DOIs and can be wiped at any time. Production mints
// REAL, permanent DOIs against a researcher's name. OAuth applications are registered
// separately per instance and the credentials are NOT interchangeable.
//
// So the failure this file guards is: a misconfiguration that silently points at
// PRODUCTION. Unset must mean sandbox, and a typo must be loud rather than lucky.

import { describe, it, expect } from "vitest";
import {
  parseZenodoEnv,
  zenodoApiBase,
  zenodoOAuthCredentials,
  ZENODO_SCOPES,
} from "@/lib/transition/zenodo-env";

describe("parseZenodoEnv", () => {
  it("defaults to sandbox when unset — never production", () => {
    expect(parseZenodoEnv({})).toBe("sandbox");
    expect(parseZenodoEnv({ ZENODO_ENV: "" })).toBe("sandbox");
    expect(parseZenodoEnv({ ZENODO_ENV: "   " })).toBe("sandbox");
  });

  it("accepts the two known values, case- and whitespace-insensitively", () => {
    expect(parseZenodoEnv({ ZENODO_ENV: "sandbox" })).toBe("sandbox");
    expect(parseZenodoEnv({ ZENODO_ENV: "production" })).toBe("production");
    expect(parseZenodoEnv({ ZENODO_ENV: "  PRODUCTION " })).toBe("production");
  });

  it("throws on an unrecognised value rather than falling back", () => {
    // "prod" is the obvious typo, and silently treating it as sandbox would send a
    // researcher's real deposit to a wipeable instance. An unlabelled fallback is
    // exactly what the house rules forbid.
    expect(() => parseZenodoEnv({ ZENODO_ENV: "prod" })).toThrow(/ZENODO_ENV/);
    expect(() => parseZenodoEnv({ ZENODO_ENV: "live" })).toThrow(/sandbox.*production|production.*sandbox/s);
  });
});

describe("zenodoApiBase", () => {
  it("points each environment at its own host", () => {
    expect(zenodoApiBase("sandbox")).toBe("https://sandbox.zenodo.org/api");
    expect(zenodoApiBase("production")).toBe("https://zenodo.org/api");
  });

  it("is https and has no trailing slash", () => {
    for (const e of ["sandbox", "production"] as const) {
      expect(zenodoApiBase(e).startsWith("https://")).toBe(true);
      expect(zenodoApiBase(e).endsWith("/")).toBe(false);
    }
  });
});

describe("zenodoOAuthCredentials", () => {
  const SANDBOX = {
    ZENODO_SANDBOX_CLIENT_ID: "sand-id",
    ZENODO_SANDBOX_CLIENT_SECRET: "sand-secret",
  };
  const PROD = { ZENODO_CLIENT_ID: "prod-id", ZENODO_CLIENT_SECRET: "prod-secret" };

  it("reads the sandbox pair for sandbox", () => {
    expect(zenodoOAuthCredentials("sandbox", { ...SANDBOX, ...PROD })).toEqual({
      clientId: "sand-id",
      clientSecret: "sand-secret",
    });
  });

  it("reads the production pair for production", () => {
    expect(zenodoOAuthCredentials("production", { ...SANDBOX, ...PROD })).toEqual({
      clientId: "prod-id",
      clientSecret: "prod-secret",
    });
  });

  it("never falls back to the other environment's credentials", () => {
    // The whole reason this module exists. Production credentials against sandbox
    // fail opaquely at the authorize step, which is a miserable thing to debug.
    expect(() => zenodoOAuthCredentials("sandbox", PROD)).toThrow(/ZENODO_SANDBOX_CLIENT_ID/);
    expect(() => zenodoOAuthCredentials("production", SANDBOX)).toThrow(/ZENODO_CLIENT_ID/);
  });

  it("names the exact missing variable for the active environment", () => {
    expect(() =>
      zenodoOAuthCredentials("sandbox", { ZENODO_SANDBOX_CLIENT_ID: "only-id" }),
    ).toThrow(/ZENODO_SANDBOX_CLIENT_SECRET/);
  });

  it("treats a blank value as missing", () => {
    expect(() =>
      zenodoOAuthCredentials("production", { ZENODO_CLIENT_ID: "  ", ZENODO_CLIENT_SECRET: "s" }),
    ).toThrow(/ZENODO_CLIENT_ID/);
  });
});

describe("ZENODO_SCOPES", () => {
  it("requests exactly what deposit needs and nothing more", () => {
    expect(ZENODO_SCOPES).toBe("deposit:write deposit:actions");
  });
});
