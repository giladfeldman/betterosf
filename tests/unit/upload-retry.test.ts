import { describe, it, expect, vi } from "vitest";
import { withRetry } from "@/lib/upload/retry";

describe("withRetry", () => {
  it("returns on first success without sleeping", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const r = await withRetry(fn, { maxAttempts: 4, sleep: vi.fn() });
    expect(r).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries while shouldRetry is true, then succeeds", async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error("transient"))
      .mockRejectedValueOnce(new Error("transient"))
      .mockResolvedValue("ok");
    const sleep = vi.fn().mockResolvedValue(undefined);
    const r = await withRetry(fn, { maxAttempts: 4, shouldRetry: () => true, sleep });
    expect(r).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("stops immediately when shouldRetry returns false", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("permanent"));
    const sleep = vi.fn();
    await expect(withRetry(fn, { maxAttempts: 5, shouldRetry: () => false, sleep })).rejects.toThrow("permanent");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("gives up after maxAttempts and throws the last error", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("still failing"));
    const sleep = vi.fn().mockResolvedValue(undefined);
    await expect(withRetry(fn, { maxAttempts: 3, shouldRetry: () => true, sleep })).rejects.toThrow("still failing");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("reports attempt count via onAttempt", async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error("x")).mockResolvedValue("ok");
    const attempts: number[] = [];
    await withRetry(fn, { maxAttempts: 3, shouldRetry: () => true, sleep: vi.fn().mockResolvedValue(undefined), onAttempt: (n) => attempts.push(n) });
    expect(attempts).toEqual([1, 2]);
  });
});
