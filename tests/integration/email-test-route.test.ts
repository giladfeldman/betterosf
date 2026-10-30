/**
 * /api/email/test may send only to the operator's own configured addresses (or the SES
 * simulator). The allowlist used to be hardcoded in the source; it now comes from the
 * environment, and an unconfigured deployment must fail closed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const sendEmail = vi.fn(async () => ({ sent: true }));
vi.mock("@/lib/admin", () => ({ requireAdmin: async () => ({ ok: true }) }));
vi.mock("@/lib/email", () => ({
  sendEmail: (...a: unknown[]) => (sendEmail as unknown as (...x: unknown[]) => unknown)(...a),
  renderEmail: async () => ({ html: "<p>x</p>", text: "x" }),
}));

import { POST } from "@/app/api/email/test/route";

const env = process.env as Record<string, string | undefined>;
const KEYS = ["ADMIN_NOTIFY_EMAIL", "NEXT_PUBLIC_ADMIN_EMAIL"];
const saved = Object.fromEntries(KEYS.map((k) => [k, env[k]]));

const post = (body: unknown) =>
  POST(
    new Request("http://localhost:4747/api/email/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }) as never,
  );

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of KEYS) delete env[k];
});
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete env[k];
    else env[k] = saved[k];
  }
});

describe("POST /api/email/test", () => {
  it("fails closed when no operator address is configured", async () => {
    const res = await post({});
    expect(res.status).toBe(400);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("sends to the configured admin address when no recipient is given", async () => {
    env.ADMIN_NOTIFY_EMAIL = "Admin@Example.org";
    const res = await post({});
    expect(res.status).toBe(200);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect((sendEmail.mock.calls[0] as unknown as [{ to: string }])[0].to).toBe("admin@example.org");
  });

  it("refuses an address that is not configured", async () => {
    env.ADMIN_NOTIFY_EMAIL = "admin@example.org";
    const res = await post({ to: "someone-else@example.com" });
    expect(res.status).toBe(400);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("allows the SES simulator without configuration", async () => {
    const res = await post({ to: "success@simulator.amazonses.com" });
    expect(res.status).toBe(200);
  });
});
