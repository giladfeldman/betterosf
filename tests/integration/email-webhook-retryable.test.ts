/**
 * d-d3473f: the SES/SNS webhook must answer 5xx on an internal failure. SNS treats any other
 * answer (400 included) as delivered and never retries, so a database hiccup answered with 400
 * lost the bounce for good. Refusals (bad signature, untrusted topic) stay 4xx.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const handle = vi.fn();
vi.mock("@/lib/email/webhook-handler", async (orig) => ({
  ...(await orig<typeof import("@/lib/email/webhook-handler")>()),
  handleSnsEvent: (...a: unknown[]) => handle(...a),
}));
const logged = vi.fn(async (..._a: unknown[]) => {});
vi.mock("@/lib/logger", async (orig) => ({
  ...(await orig<typeof import("@/lib/logger")>()),
  logEventAwaited: (...a: unknown[]) => logged(...a),
}));

import { POST } from "@/app/api/email/webhook/route";
import { SnsSignatureError } from "@/lib/email/webhook-handler";

const req = (body: string) =>
  new NextRequest("http://localhost:4747/api/email/webhook", { method: "POST", body, headers: { "content-type": "application/json" } });
const envelope = JSON.stringify({ Type: "Notification", Message: "{}", TopicArn: "arn:aws:sns:eu-west-1:1:t" });

beforeEach(() => {
  handle.mockReset();
  logged.mockClear();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("SNS webhook answers", () => {
  it("a database failure answers 503 (retryable) and writes an error row", async () => {
    handle.mockRejectedValue(new Error("connection terminated unexpectedly"));
    const res = await POST(req(envelope));
    expect(res.status).toBe(503);
    expect(logged).toHaveBeenCalledWith("error", "email", expect.stringContaining("503"), expect.anything());
  });

  it("a bad signature answers 403 (refused, not retried)", async () => {
    handle.mockRejectedValue(new SnsSignatureError("bad signature"));
    expect((await POST(req(envelope))).status).toBe(403);
    expect(logged).not.toHaveBeenCalled();
  });

  it("an untrusted topic answers 403", async () => {
    handle.mockResolvedValue({ ok: false, error: "topic_not_allowed" });
    expect((await POST(req(envelope))).status).toBe(403);
  });

  it("unreadable JSON answers 400", async () => {
    expect((await POST(req("{not json"))).status).toBe(400);
  });

  it("control: a stored event answers 200", async () => {
    handle.mockResolvedValue({ ok: true, inserted: 1 });
    expect((await POST(req(envelope))).status).toBe(200);
  });
});
