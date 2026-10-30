/**
 * A project deleted on OSF answers 410 ("The requested node is no longer available").
 *
 * THE DEFECT, reported from production 2026-10-30: the transition page for k3ny2 — a
 * project still in the browser's cached project list but deleted on OSF — said "Could
 * not read this project from OSF. Nothing was changed — try again." with a 502. 410 fell
 * through to code "unknown", so the plan route's catch-all called it an outage, and
 * "try again" can never succeed for a deleted project.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/logger", () => ({
  logWarn: vi.fn(),
  logInfo: vi.fn(),
  logError: vi.fn(),
  logEventAwaited: vi.fn(),
}));

import { mapError } from "@/lib/osf/client";
import { osfErrorResponse } from "@/lib/osf/error-response";

const OSF_410_BODY =
  '{"errors":[{"source":{},"detail":"The requested node is no longer available.","meta":{},"status":"410"}],"meta":{"version":"2.0"}}';

describe("OSF 410 (deleted node)", () => {
  it("is classified as not_found, so every not-found branch in the app handles it", () => {
    const e = mapError(410, OSF_410_BODY);
    expect(e.code).toBe("not_found");
    expect(e.status).toBe(410);
  });

  it("maps to a 410 that says 'deleted' and does not tell the user to retry", async () => {
    const res = osfErrorResponse(mapError(410, OSF_410_BODY))!;
    expect(res).not.toBeNull();
    expect(res.status).toBe(410);
    const body = await res.json();
    expect(body.code).toBe("osf_deleted");
    expect(body.error).toMatch(/deleted on OSF/i);
    expect(body.action).toMatch(/refresh your project list/i);
    expect(body.action).not.toMatch(/^retry/i);
  });

  it("leaves a plain 404 as 'no record with that id'", async () => {
    const body = await osfErrorResponse(mapError(404, ""))!.json();
    expect(body.code).toBe("not_found");
  });
});
