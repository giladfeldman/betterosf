/**
 * Regression (user report 2026-08-04): a signed-in user with an expired OSF
 * token saw the generic "Couldn't load this project" error boundary on project
 * and deep file pages instead of an actionable reconnect prompt.
 *
 * OSF returns 401 for an expired/revoked token, which `client.ts` maps to
 * OsfError("unauthorized"). Only 429/5xx were classified as soft-failable, so
 * 401 rethrew into `[guid]/error.tsx` and destroyed the page.
 *
 * These tests pin BOTH halves of the fix:
 *  - the classifier now recognises `unauthorized` as its own soft kind, and
 *  - the shared notice renders a "Reconnect OSF" action for it.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { osfBackpressureKind } from "@/lib/osf/backpressure";
import { OsfBackpressureNotice } from "@/components/OsfBackpressureNotice";
import { OsfError } from "@/lib/osf/types";

describe("expired OSF token is a soft, recoverable page state", () => {
  it("classifies a 401 as needs_reconnect (previously: null -> rethrow -> error boundary)", () => {
    expect(osfBackpressureKind(new OsfError(401, "unauthorized", "OSF authentication required"))).toBe(
      "needs_reconnect",
    );
  });

  it("keeps the existing backpressure classifications unchanged", () => {
    expect(osfBackpressureKind(new OsfError(429, "rate_limited", ""))).toBe("rate_limited");
    expect(osfBackpressureKind(new OsfError(503, "upstream", ""))).toBe("upstream");
  });

  it("still returns null for errors that must keep propagating", () => {
    expect(osfBackpressureKind(new OsfError(404, "not_found", ""))).toBeNull();
    expect(osfBackpressureKind(new OsfError(403, "forbidden", ""))).toBeNull();
    expect(osfBackpressureKind(new TypeError("boom"))).toBeNull();
  });

  it("renders a Reconnect OSF action for the expired-token state", () => {
    render(<OsfBackpressureNotice kind="needs_reconnect" resourceLabel="this project" />);
    const link = screen.getByRole("link", { name: /reconnect osf/i });
    expect(link).toHaveAttribute("href", "/login");
    // Must NOT blame OSF for what is really a local credential problem.
    expect(screen.queryByText(/asked BetterOSF to slow down/i)).toBeNull();
  });

  it("does not show a reconnect action for ordinary backpressure", () => {
    render(<OsfBackpressureNotice kind="rate_limited" resourceLabel="this project" />);
    expect(screen.queryByRole("link", { name: /reconnect osf/i })).toBeNull();
  });
});
