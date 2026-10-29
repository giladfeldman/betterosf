/**
 * d-035eb4 — a rate-limit story for signed-in bug reporters.
 *
 * The 10-per-hour feedback cap was keyed on the IP address alone, so everyone behind one
 * university NAT shared it: ten reports from a lab and the eleventh researcher was told to
 * wait an hour. A signed-in reporter now has their OWN 10/hour budget, keyed on the OSF user
 * id from a server-verified session (`auth()`), never on a cookie's mere presence — that
 * forgeable shortcut is what the middleware's flat limit exists to avoid. Anonymous reports
 * keep the per-IP cap, and a generous per-IP ceiling still bounds a single address.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { _resetForTests } from "@/lib/limits";

let session: { osfUserId: string } | null = null;
vi.mock("@/auth", () => ({ auth: async () => session }));
vi.mock("@/lib/db/bug-reports", () => ({ insertBugReport: async () => "11111111-1111-4111-8111-111111111111" }));
vi.mock("@/lib/db/users", () => ({ findUserByOsfId: async () => null }));
vi.mock("@/lib/logger", () => ({ logInfo: () => {}, logError: () => {}, logWarn: () => {}, errorDetails: () => ({}) }));

function post(ip = "10.0.0.1"): Request {
  return new Request("http://localhost:4747/api/feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-real-ip": ip },
    body: JSON.stringify({ kind: "bug", message: "The tree does not load on my project." }),
  });
}

beforeEach(() => {
  _resetForTests();
  session = null;
  delete process.env.ADMIN_NOTIFY_EMAIL;
});

async function send(n: number, ip?: string): Promise<number[]> {
  const { POST } = await import("@/app/api/feedback/route");
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push((await POST(post(ip))).status);
  return out;
}

describe("feedback rate limit", () => {
  it("anonymous reports keep the per-IP cap of 10/hour", async () => {
    const statuses = await send(11);
    expect(statuses.slice(0, 10).every((s) => s === 201)).toBe(true);
    expect(statuses[10]).toBe(429);
  }, 20_000);

  it("a signed-in reporter behind a NAT whose anonymous budget is spent can still report", async () => {
    await send(10); // ten anonymous reports from the shared address
    session = { osfUserId: "osfA" };
    expect(await send(1)).toEqual([201]);
  });

  it("each signed-in user has their own 10/hour budget", async () => {
    session = { osfUserId: "osfA" };
    const a = await send(11);
    expect(a[10]).toBe(429);
    session = { osfUserId: "osfB" };
    expect(await send(1)).toEqual([201]);
  });

  it("one address is still bounded overall, signed in or not", async () => {
    let allowed = 0;
    for (let u = 0; u < 20; u++) {
      session = { osfUserId: `osf${u}` };
      allowed += (await send(10)).filter((s) => s === 201).length;
    }
    expect(allowed).toBeLessThanOrEqual(100);
  });
});
