import { describe, it, expect } from "vitest";
import { classifyUploadError } from "@/lib/upload/classify";

describe("classifyUploadError", () => {
  it("treats a thrown network error as retryable connectivity", () => {
    const r = classifyUploadError({ threw: true });
    expect(r.cause).toBe("connectivity");
    expect(r.retryable).toBe(true);
  });

  it("treats 5xx as retryable osf_down", () => {
    const r = classifyUploadError({ status: 503 });
    expect(r.cause).toBe("osf_down");
    expect(r.retryable).toBe(true);
  });

  it("treats 429 as retryable rate_limited (distinct from 5xx)", () => {
    const r = classifyUploadError({ status: 429 });
    expect(r.cause).toBe("rate_limited");
    expect(r.retryable).toBe(true);
  });

  it("treats 401/403 as non-retryable permission", () => {
    expect(classifyUploadError({ status: 401 })).toMatchObject({ cause: "permission", retryable: false });
    expect(classifyUploadError({ status: 403 })).toMatchObject({ cause: "permission", retryable: false });
  });

  it("treats 400 invalid as non-retryable betterosf bug", () => {
    const r = classifyUploadError({ status: 400, code: "invalid" });
    expect(r.cause).toBe("betterosf");
    expect(r.retryable).toBe(false);
  });

  it("treats 413 too_large as non-retryable", () => {
    expect(classifyUploadError({ status: 413 })).toMatchObject({ retryable: false });
  });

  it("carries through a server message as detail", () => {
    expect(classifyUploadError({ status: 503, message: "gateway" }).message).toContain("gateway");
  });
});
