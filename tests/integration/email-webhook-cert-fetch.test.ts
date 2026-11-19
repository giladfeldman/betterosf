/**
 * A failure to FETCH the SNS signing certificate is an upstream outage, not a refused
 * signature: SNS must be told 5xx (retry), never the 403 that drops the bounce for good
 * (same class as d-d3473f). A genuinely bad signature stays a SnsSignatureError.
 */
import { describe, it, expect, vi } from "vitest";

let validateError: Error | null = null;
vi.mock("sns-validator", () => ({
  default: class {
    validate(_p: unknown, cb: (e: Error | null) => void) {
      cb(validateError);
    }
  },
}));

import { handleSnsEvent, SnsSignatureError } from "@/lib/email/webhook-handler";

const payload = { Type: "Notification", Message: "{}", TopicArn: "arn:aws:sns:eu-west-1:1:t" } as never;

describe("verifySignature error classes", () => {
  it("certificate could not be retrieved is NOT a signature refusal", async () => {
    validateError = new Error("Certificate could not be retrieved");
    const err = await handleSnsEvent(payload).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(SnsSignatureError);
  });

  it("control: an invalid signature is a SnsSignatureError", async () => {
    validateError = new Error("The message signature is invalid.");
    const err = await handleSnsEvent(payload).catch((e) => e);
    expect(err).toBeInstanceOf(SnsSignatureError);
  });
});
