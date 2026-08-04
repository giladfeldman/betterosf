/**
 * Regression (reported by the user 2026-08-04, reproduced locally the same day):
 *
 * A SIGNED-IN user whose OSF access token had expired/been revoked saw
 * "Couldn't load this project" on every deep file/folder URL — e.g.
 *   /3kmr9/files/view/osfstorage/PCIRR Stage 1/.../Figures/test/testing/test.txt
 * while the SAME paths worked fine anonymously.
 *
 * Root cause: `src/lib/osf/client.ts` maps OSF's HTTP 401 to
 * `OsfError("unauthorized")`. Both deep-path routes caught only
 *   not_found | forbidden | rate_limited | upstream
 * so `unauthorized` fell through the `walk()` try/catch and RETHREW, which
 * Next.js turns into the `[guid]/error.tsx` boundary — losing the tree, the
 * breadcrumb, and any way to recover. Anonymous browsing never hits it because
 * an anonymous request sends no bearer token and so never gets a 401.
 *
 * The fix classifies `unauthorized` as a walk failure with its own reason
 * ("needs-reconnect") so the page renders its normal chrome plus an actionable
 * "reconnect OSF" panel instead of the generic error boundary.
 *
 * These tests assert against the REAL exported helpers so they cannot drift
 * from the production code path.
 */
import { describe, it, expect } from "vitest";
import { OsfError } from "@/lib/osf/types";
import { classifyWalkFailure } from "@/lib/osf/walk-failure";

describe("deep-path walk classification of OSF auth failures", () => {
  it("classifies a 401 as needs-reconnect instead of rethrowing (THE regression)", () => {
    // This is exactly what client.ts produces for an expired/revoked token.
    const err = new OsfError(401, "unauthorized", "OSF authentication required");
    expect(classifyWalkFailure(err)).toBe("needs-reconnect");
  });

  it("still classifies the previously-handled codes unchanged", () => {
    expect(classifyWalkFailure(new OsfError(404, "not_found", ""))).toBe("upstream-error");
    expect(classifyWalkFailure(new OsfError(403, "forbidden", ""))).toBe("upstream-error");
    expect(classifyWalkFailure(new OsfError(429, "rate_limited", ""))).toBe("upstream-error");
    expect(classifyWalkFailure(new OsfError(503, "upstream", ""))).toBe("upstream-error");
  });

  it("returns null for genuinely unexpected errors so they keep propagating", () => {
    // A programming error must NOT be silently swallowed into a pretty panel.
    expect(classifyWalkFailure(new TypeError("x is not a function"))).toBeNull();
    expect(classifyWalkFailure(new OsfError(418, "unknown", ""))).toBeNull();
  });
});
