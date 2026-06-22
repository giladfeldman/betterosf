import { describe, it, expect } from "vitest";
import { http, HttpResponse } from "msw";
import { render, screen } from "@testing-library/react";
import { server } from "../msw/server";
import ProjectPage from "@/app/[guid]/page";
import FilesPage from "@/app/[guid]/files/page";
import DeepFilesPage from "@/app/[guid]/files/[...path]/page";
import CompareRegistrationsPage from "@/app/registrations/compare/page";
import { RegistrationOverview } from "@/components/RegistrationOverview";
import { PreprintOverview } from "@/components/PreprintOverview";
import { UserProfile } from "@/components/UserProfile";

/**
 * Production-incident regression suite.
 *
 * On 2026-06-22 Vercel alerted on a burst of 5xx errors on `/[guid]` "from
 * api.osf.io rate limiting". Root cause: when OSF returns HTTP 429 (rate limit)
 * for a critical render-path fetch, the OSF client maps it to
 * `OsfError(429, "rate_limited")` and the page rethrew it — Next.js turns an
 * unhandled server-component throw into an HTTP 500, which is what Vercel counts
 * as a 5xx. OSF rate-limits BetterOSF's shared Vercel egress IP, so a traffic
 * burst across many guids 5xx'd every cache-miss request.
 *
 * Desired behavior: OSF *backpressure* (429 rate_limited, or a persistent 5xx
 * mapped to `upstream` after the client's retries) is transient and NOT a fault
 * on our side. Every typed-resource / file route must degrade to a soft HTTP 200
 * "retry" state instead of throwing, so OSF throttling stops producing 5xx.
 *
 * Each test makes EVERY OSF v2 call 429 (both the anonymous bucket and the
 * app-token fallback the client tries next), then asserts the route resolves to
 * the retry notice rather than rejecting.
 */
function rateLimitAllOsf() {
  server.use(
    http.get("https://api.osf.io/v2/*", () => new HttpResponse(null, { status: 429 })),
  );
}

function expectRetryNotice() {
  // The soft state is the only thing rendered, and it offers a Retry control.
  expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: /waiting on osf/i })).toBeInTheDocument();
}

describe("OSF rate-limit backpressure → soft 200 (not 5xx)", () => {
  it("/[guid] project overview renders a retry state when OSF rate-limits the node lookup", async () => {
    rateLimitAllOsf();
    const ui = await ProjectPage({
      params: Promise.resolve({ guid: "ezcuj" }),
      searchParams: Promise.resolve({}),
    });
    render(ui);
    expectRetryNotice();
  });

  it("registration overview renders a retry state on OSF rate-limit", async () => {
    rateLimitAllOsf();
    const ui = await RegistrationOverview({ guid: "regaa" });
    render(ui);
    expectRetryNotice();
  });

  it("preprint overview renders a retry state on OSF rate-limit", async () => {
    rateLimitAllOsf();
    const ui = await PreprintOverview({ guid: "prepa" });
    render(ui);
    expectRetryNotice();
  });

  it("user profile renders a retry state on OSF rate-limit", async () => {
    rateLimitAllOsf();
    const ui = await UserProfile({ guid: "usera", basePath: "/users/usera", searchParams: {} });
    render(ui);
    expectRetryNotice();
  });

  it("/[guid]/files renders a retry state on OSF rate-limit", async () => {
    rateLimitAllOsf();
    const ui = await FilesPage({ params: Promise.resolve({ guid: "filea" }) });
    render(ui);
    expectRetryNotice();
  });

  it("/[guid]/files/[...path] deep folder renders a retry state on OSF rate-limit", async () => {
    rateLimitAllOsf();
    const ui = await DeepFilesPage({
      params: Promise.resolve({ guid: "filea", path: ["osfstorage", "sub"] }),
    });
    render(ui);
    expectRetryNotice();
  });

  it("/registrations/compare renders a retry state on OSF rate-limit", async () => {
    rateLimitAllOsf();
    const ui = await CompareRegistrationsPage({
      searchParams: Promise.resolve({ a: "regaa", b: "regbb" }),
    });
    render(ui);
    expectRetryNotice();
  });
});
