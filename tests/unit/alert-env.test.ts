/**
 * d-bf671b — the owner's admin-alert rule (2026-10-23): an alert email is an urgent
 * PRODUCTION problem. Every event records where it happened (from the platform's own
 * marker, never NODE_ENV — `next start` on a laptop IS NODE_ENV=production); only
 * production is emailed by default; a non-production email needs an explicit opt-in and
 * then says so in its subject. Tested in both directions.
 */
import { describe, it, expect, afterEach } from "vitest";
import { deploymentEnvironment, alertEmailPolicy, LOCAL_TEST_SUBJECT_PREFIX } from "@/lib/alert-env";

const KEYS = ["VERCEL_ENV", "RAILWAY_ENVIRONMENT_NAME", "RENDER", "ALERT_EMAILS_NON_PRODUCTION", "NODE_ENV"];
const env = process.env as Record<string, string | undefined>;
const saved = Object.fromEntries(KEYS.map((k) => [k, env[k]]));
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete env[k];
    else env[k] = saved[k];
  }
});
function setEnv(vars: Record<string, string>) {
  for (const k of KEYS) delete env[k];
  Object.assign(env, vars);
}

describe("deploymentEnvironment comes from the platform marker, never NODE_ENV", () => {
  it("Vercel production is production", () => {
    setEnv({ VERCEL_ENV: "production" });
    expect(deploymentEnvironment()).toBe("production");
  });
  it("Vercel preview is preview", () => {
    setEnv({ VERCEL_ENV: "preview" });
    expect(deploymentEnvironment()).toBe("preview");
  });
  it("a local `next start` (NODE_ENV=production, no platform marker) is LOCAL", () => {
    setEnv({ NODE_ENV: "production" });
    expect(deploymentEnvironment()).toBe("local");
  });
  it("vercel dev (VERCEL_ENV=development) is not production", () => {
    setEnv({ VERCEL_ENV: "development" });
    expect(deploymentEnvironment()).toBe("development");
  });
});

describe("alertEmailPolicy", () => {
  it("a production event is emailed, unlabelled", () => {
    const p = alertEmailPolicy("production", { optIn: false });
    expect(p.send).toBe(true);
    expect(p.subject("[BetterOSF] New bug: x")).toBe("[BetterOSF] New bug: x");
    expect(p.banner).toBeNull();
  });
  it("a local or preview event is NOT emailed by default", () => {
    expect(alertEmailPolicy("local", { optIn: false }).send).toBe(false);
    expect(alertEmailPolicy("preview", { optIn: false }).send).toBe(false);
  });
  it("an opted-in local event is emailed, and its subject STARTS with the local-test label", () => {
    const p = alertEmailPolicy("local", { optIn: true });
    expect(p.send).toBe(true);
    expect(LOCAL_TEST_SUBJECT_PREFIX).toBe("[LOCAL TEST - NOT PRODUCTION]");
    expect(p.subject("[BetterOSF] New bug: x").startsWith(LOCAL_TEST_SUBJECT_PREFIX)).toBe(true);
    expect(p.banner).toMatch(/no production user was affected/i);
  });
  it("an opted-in preview event names its own environment", () => {
    expect(alertEmailPolicy("preview", { optIn: true }).subject("s")).toMatch(/^\[PREVIEW - NOT PRODUCTION\]/);
  });
  it("the opt-in reads ALERT_EMAILS_NON_PRODUCTION=1 from the environment by default", () => {
    setEnv({ ALERT_EMAILS_NON_PRODUCTION: "1" });
    expect(alertEmailPolicy("local").send).toBe(true);
    setEnv({});
    expect(alertEmailPolicy("local").send).toBe(false);
  });
});
