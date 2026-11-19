/**
 * d-3fd24d: logError's write (and its admin alert) must be registered with after() so the
 * platform keeps the function alive until it finishes, instead of floating and being frozen.
 */
import { describe, it, expect, vi } from "vitest";

const afterSpy = vi.fn();
vi.mock("next/server", async (orig) => ({
  ...(await orig<typeof import("next/server")>()),
  after: (w: unknown) => afterSpy(w),
}));

import { keepAlive } from "@/lib/logger";

describe("keepAlive", () => {
  it("hands the promise to after() inside a request", () => {
    const p = Promise.resolve(1);
    keepAlive(p);
    expect(afterSpy).toHaveBeenCalledWith(p);
  });

  it("outside a request (after() throws) it does not throw", () => {
    afterSpy.mockImplementationOnce(() => { throw new Error("after() called outside a request scope"); });
    expect(() => keepAlive(Promise.resolve(1))).not.toThrow();
  });
});
