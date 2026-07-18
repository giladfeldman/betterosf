import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleSnsEvent } from "@/lib/email/webhook-handler";

describe("SNS webhook TopicArn allowlist", () => {
  const topic = "arn:aws:sns:eu-west-1:123456789012:ses-events-betterosf";

  beforeEach(() => {
    vi.stubEnv("SNS_TOPIC_ARN", topic);
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL", "1");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("rejects a foreign TopicArn even when signature verify is skipped", async () => {
    const result = await handleSnsEvent(
      {
        Type: "Notification",
        TopicArn: "arn:aws:sns:eu-west-1:999999999999:attacker",
        Message: "{}",
      },
      { skipVerify: true },
    );
    expect(result).toEqual({ ok: false, error: "topic_not_allowed" });
  });

  it("allows the configured TopicArn", async () => {
    const result = await handleSnsEvent(
      {
        Type: "Notification",
        TopicArn: topic,
        Message: JSON.stringify({ notificationType: "Delivery" }),
      },
      { skipVerify: true },
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.inserted).toBe(0);
  });
});
