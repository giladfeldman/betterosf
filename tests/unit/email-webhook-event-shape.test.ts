/**
 * SES speaks TWO shapes for the same event, and this handler understood only one.
 *
 * Identity-level notifications say `notificationType`; configuration-set EVENT
 * DESTINATIONS — the mechanism that actually delivers bounce feedback to BetterOSF
 * (`ses-events-betterosf-config` → topic `ses-events-betterosf`) — say `eventType`.
 * There is no identity-level fallback on any betterosf identity, so 100% of real
 * bounces arrive as `eventType`.
 *
 * The failure was invisible from every dashboard: signature verified, topic gate
 * passed, JSON parsed, no branch matched, `{ inserted: 0 }`, HTTP 200. SNS records a
 * SUCCESSFUL delivery. Nothing stored, nothing suppressed, nothing logged.
 *
 * Found and fixed identically in Metaventory v0.7.20 on 2026-08-26.
 *
 * The alias was a one-line bug. The defect worth pinning is that the miss was SILENT —
 * so the unrecognised-event tests below matter more than the Bounce ones, because the
 * next unknown shape is by definition the one nobody anticipated.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TOPIC = "arn:aws:sns:eu-west-1:123456789012:ses-events-betterosf";

const rows: Record<string, unknown>[] = [];
const logDurable = vi.fn(async (..._args: unknown[]) => true);

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    insert: () => ({
      values: async (values: Record<string, unknown>) => {
        rows.push(values);
      },
    }),
  }),
}));

vi.mock("@/lib/logger", () => ({
  logEventAwaited: (...args: unknown[]) => logDurable(...args),
  logWarn: (...args: unknown[]) => logDurable(...args),
  logInfo: () => {},
  logError: () => {},
  errorDetails: () => ({}),
}));

import { handleSnsEvent } from "@/lib/email/webhook-handler";

function envelope(message: unknown) {
  return {
    Type: "Notification" as const,
    TopicArn: TOPIC,
    Message: typeof message === "string" ? message : JSON.stringify(message),
  };
}

/** The real shape AWS publishes to a configuration-set event destination. */
const CONFIG_SET_BOUNCE = {
  eventType: "Bounce",
  bounce: {
    bounceType: "Permanent",
    bounceSubType: "General",
    bouncedRecipients: [
      {
        emailAddress: "bounce@simulator.amazonses.com",
        action: "failed",
        status: "5.1.1",
        diagnosticCode: "smtp; 550 5.1.1 user unknown",
      },
    ],
    timestamp: "2026-08-27T09:00:00.000Z",
    feedbackId: "0100019...-000000",
  },
  mail: {
    timestamp: "2026-08-27T09:00:00.000Z",
    source: "betterosf@scimeto.app",
    messageId: "0100019abc-config-set",
    destination: ["bounce@simulator.amazonses.com"],
  },
};

beforeEach(() => {
  rows.length = 0;
  logDurable.mockClear();
  logDurable.mockImplementation(async (..._args: unknown[]) => true);
  vi.stubEnv("SNS_TOPIC_ARN", TOPIC);
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("VERCEL", "1");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("SES event-shape dispatch", () => {
  it("records a bounce delivered as a configuration-set event (eventType)", async () => {
    const result = await handleSnsEvent(envelope(CONFIG_SET_BOUNCE), { skipVerify: true });

    expect(result).toMatchObject({ ok: true, inserted: 1 });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      email: "bounce@simulator.amazonses.com",
      type: "bounce",
      bounceType: "Permanent",
      messageId: "0100019abc-config-set",
      reason: "smtp; 550 5.1.1 user unknown",
    });
  });

  it("still records the identity-level shape (notificationType)", async () => {
    const identityBounce = {
      notificationType: "Bounce",
      bounce: {
        bounceType: "Transient",
        bouncedRecipients: [{ emailAddress: "Someone@Example.COM", diagnosticCode: "smtp; 421 busy" }],
      },
      mail: { messageId: "identity-1" },
    };

    const result = await handleSnsEvent(envelope(identityBounce), { skipVerify: true });

    expect(result).toMatchObject({ ok: true, inserted: 1 });
    expect(rows[0]).toMatchObject({ email: "someone@example.com", type: "bounce", bounceType: "Transient" });
  });

  it("records a complaint delivered as a configuration-set event (eventType)", async () => {
    const configSetComplaint = {
      eventType: "Complaint",
      complaint: { complainedRecipients: [{ emailAddress: "complaint@simulator.amazonses.com" }] },
      mail: { messageId: "complaint-1" },
    };

    const result = await handleSnsEvent(envelope(configSetComplaint), { skipVerify: true });

    expect(result).toMatchObject({ ok: true, inserted: 1 });
    expect(rows[0]).toMatchObject({ email: "complaint@simulator.amazonses.com", type: "complaint" });
  });
});

describe("SES events we do not understand leave a trace", () => {
  it("warns, naming the type, when no branch matches", async () => {
    await handleSnsEvent(
      envelope({ eventType: "SomethingSesInventedLater", widget: { emailAddress: "victim@example.com" } }),
      { skipVerify: true },
    );

    expect(logDurable).toHaveBeenCalledTimes(1);
    const [, , message] = logDurable.mock.calls[0] as [string, string, string, Record<string, unknown>];
    expect(message).toContain("SomethingSesInventedLater");
  });

  it("names the message's top-level KEYS so the unknown shape is diagnosable", async () => {
    await handleSnsEvent(
      envelope({ eventType: "SomethingSesInventedLater", widget: { emailAddress: "victim@example.com" } }),
      { skipVerify: true },
    );

    const [, , , context] = logDurable.mock.calls[0] as [string, string, string, Record<string, unknown>];
    expect(context.keys).toEqual(expect.arrayContaining(["eventType", "widget"]));
  });

  it("never puts a recipient address in the trace — keys only, never values", async () => {
    await handleSnsEvent(
      envelope({
        eventType: "SomethingSesInventedLater",
        widget: { emailAddress: "victim@example.com" },
        mail: { destination: ["victim@example.com"] },
      }),
      { skipVerify: true },
    );

    expect(JSON.stringify(logDurable.mock.calls)).not.toContain("victim@example.com");
  });

  it("warns when the SNS Message body is not JSON at all", async () => {
    const result = await handleSnsEvent(envelope("<html>not json</html>"), { skipVerify: true });

    expect(result).toMatchObject({ ok: true, inserted: 0 });
    expect(logDurable).toHaveBeenCalledTimes(1);
  });

  it("waits for the trace to land before answering — a fire-and-forget write dies with the serverless instance", async () => {
    let landed = false;
    logDurable.mockImplementation(async (..._args: unknown[]) => {
      await new Promise((r) => setTimeout(r, 10));
      landed = true;
      return true;
    });

    await handleSnsEvent(envelope({ eventType: "SomethingSesInventedLater" }), { skipVerify: true });

    expect(landed).toBe(true);
  });

  it.each(["Delivery", "Send", "Reject", "Open", "Click", "Rendering Failure", "DeliveryDelay", "Subscription"])(
    "stays silent for %s, which we ignore on purpose",
    async (eventType) => {
      const result = await handleSnsEvent(envelope({ eventType, mail: { messageId: "m" } }), { skipVerify: true });

      expect(result).toMatchObject({ ok: true, inserted: 0 });
      expect(logDurable).not.toHaveBeenCalled();
    },
  );

  it("stays silent for the identity-level Delivery notification too", async () => {
    const result = await handleSnsEvent(
      envelope({ notificationType: "Delivery", mail: { messageId: "m" } }),
      { skipVerify: true },
    );

    expect(result).toMatchObject({ ok: true, inserted: 0 });
    expect(logDurable).not.toHaveBeenCalled();
  });
});
