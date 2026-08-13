/**
 * Reading an error response without losing what it said.
 *
 * THE DEFECT, reported from production 2026-08-13: `osfErrorResponse` returned a
 * plain-TEXT body, every caller read it with `res.json()`, the parse threw, and the
 * catch replaced a precise message — "Your OSF connection expired. Reconnect OSF and
 * try again." — with "Could not load your projects (HTTP 401)". The server had already
 * worked out exactly what was wrong and the answer never reached the user.
 *
 * So there are two halves to pin: the route now returns JSON, and the reader can no
 * longer lose a message whatever shape the body arrives in.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/logger", () => ({
  logWarn: vi.fn(),
  logInfo: vi.fn(),
  logError: vi.fn(),
  logEventAwaited: vi.fn(),
}));

import { readApiError, networkError } from "@/lib/api-error";
import { osfErrorResponse, appErrorResponse } from "@/lib/osf/error-response";
import { OsfError } from "@/lib/osf/types";

describe("osfErrorResponse", () => {
  it("returns JSON, because every caller reads errors with res.json()", async () => {
    const res = osfErrorResponse(new OsfError(401, "unauthorized", "nope"))!;
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    const body = await res.json();
    expect(body.error).toMatch(/expired/i);
  });

  it("says what to DO about an expired token, not just that it expired", async () => {
    // "Try again" is advice that can never succeed: retrying does not renew a token.
    const body = await osfErrorResponse(new OsfError(401, "unauthorized", "nope"))!.json();
    expect(body.action).toMatch(/sign in again|reconnect/i);
    expect(body.code).toBe("osf_unauthorized");
  });

  it("carries a request id that an admin can look up", async () => {
    const body = await osfErrorResponse(new OsfError(502, "upstream", "bad gateway"))!.json();
    expect(body.requestId).toMatch(/^req_/);
    expect(body.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("distinguishes OSF being down from BetterOSF being broken", () => {
    // 502, not 500 — so an OSF outage does not read as our bug in monitoring.
    expect(osfErrorResponse(new OsfError(503, "upstream", "x"))!.status).toBe(502);
    expect(osfErrorResponse(new OsfError(429, "rate_limited", "x"))!.status).toBe(429);
    expect(osfErrorResponse(new OsfError(404, "not_found", "x"))!.status).toBe(404);
  });

  it("still returns null for a non-OSF error, so real bugs are not disguised", () => {
    expect(osfErrorResponse(new Error("undefined is not a function"))).toBeNull();
  });

  it("never caches an error response", () => {
    const res = osfErrorResponse(new OsfError(401, "unauthorized", "x"))!;
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("keeps the upstream body out of the browser but names the status", async () => {
    const body = await osfErrorResponse(new OsfError(403, "forbidden", "SECRET INTERNAL DETAIL"), {
      endpoint: "/v2/users/me/nodes/",
    })!.json();
    expect(JSON.stringify(body)).not.toContain("SECRET INTERNAL DETAIL");
    expect(body.detail).toContain("403");
    expect(body.detail).toContain("/v2/users/me/nodes/");
  });
});

describe("the request id actually connects the user to the admin log", () => {
  it("logs the SAME id it shows, in a field /admin/logs searches", async () => {
    // The whole "quote this id" affordance is a seam: the browser shows one value and the
    // server writes another somewhere. Each half can be correct on its own while the pair
    // is useless. /admin/logs searches the message and the JSON of `context`, so the id
    // has to be in one of those.
    const { logWarn } = await import("@/lib/logger");
    vi.mocked(logWarn).mockClear();

    const body = await osfErrorResponse(new OsfError(401, "unauthorized", "x"))!.json();
    expect(logWarn).toHaveBeenCalledTimes(1);

    const [, , context] = vi.mocked(logWarn).mock.calls[0]!;
    expect((context as Record<string, unknown>).requestId).toBe(body.requestId);
    // The admin page stringifies context and substring-matches the query.
    expect(JSON.stringify(context).toLowerCase()).toContain(body.requestId.toLowerCase());
  });

  it("logs the upstream body an admin needs but the browser never gets", async () => {
    const { logWarn } = await import("@/lib/logger");
    vi.mocked(logWarn).mockClear();
    const body = await osfErrorResponse(new OsfError(403, "forbidden", "upstream said no"))!.json();
    const [, , context] = vi.mocked(logWarn).mock.calls[0]!;
    expect(JSON.stringify(context)).toContain("upstream said no");
    expect(JSON.stringify(body)).not.toContain("upstream said no");
  });

  it("gives every failure a DIFFERENT id, or the search finds the wrong one", async () => {
    const a = await osfErrorResponse(new OsfError(401, "unauthorized", "x"))!.json();
    const b = await osfErrorResponse(new OsfError(401, "unauthorized", "x"))!.json();
    expect(a.requestId).not.toBe(b.requestId);
  });
});

describe("appErrorResponse", () => {
  it("produces the same shape, so one client renderer handles every error", async () => {
    const body = await appErrorResponse({
      status: 502,
      code: "inventory_failed",
      error: "Could not read your project list from OSF.",
      action: "Retry.",
    }).json();
    expect(Object.keys(body).sort()).toEqual(
      ["action", "at", "code", "detail", "error", "requestId"].sort(),
    );
  });

  it("logs the cause without sending it to the browser", async () => {
    const res = appErrorResponse({
      status: 500,
      code: "boom",
      error: "Something went wrong.",
      cause: new Error("connection string leaked here"),
    });
    expect(JSON.stringify(await res.json())).not.toContain("connection string leaked here");
  });
});

describe("readApiError", () => {
  const json = (body: unknown, status: number) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

  it("reads a structured error whole", async () => {
    const err = await readApiError(
      json(
        {
          error: "Your OSF connection expired.",
          action: "Sign in again.",
          code: "osf_unauthorized",
          detail: "OSF returned HTTP 401.",
          requestId: "req_abc123",
          at: "2026-08-13T00:00:00.000Z",
        },
        401,
      ),
      "/api/transition/inventory",
    );
    expect(err.message).toBe("Your OSF connection expired.");
    expect(err.action).toBe("Sign in again.");
    expect(err.code).toBe("osf_unauthorized");
    expect(err.requestId).toBe("req_abc123");
    expect(err.endpoint).toBe("/api/transition/inventory");
  });

  it("KEEPS a plain-text message instead of discarding it — the shipped defect", async () => {
    const res = new Response("Your OSF connection expired. Reconnect OSF and try again.", {
      status: 401,
    });
    const err = await readApiError(res);
    expect(err.message).toMatch(/expired/i);
    expect(err.message).not.toMatch(/HTTP 401/);
  });

  it("does not show an HTML gateway page as if it were a message", async () => {
    // A Vercel challenge or a proxy error page is not something to print at a user.
    const err = await readApiError(
      new Response("<!doctype html><html><body>Security Checkpoint</body></html>", { status: 401 }),
    );
    expect(err.message).not.toMatch(/doctype|html/i);
    expect(err.message).toMatch(/signed in|expired/i);
    expect(err.detail).toMatch(/gateway/i);
  });

  it("falls back by status only when the body genuinely said nothing", async () => {
    expect((await readApiError(new Response("", { status: 504 }))).message).toMatch(/timed out/i);
    expect((await readApiError(new Response("", { status: 403 }))).message).toMatch(/access/i);
    expect((await readApiError(new Response("", { status: 500 }))).message).toMatch(/server/i);
  });

  it("survives a body that is JSON but not our shape", async () => {
    const err = await readApiError(json({ message: "who knows" }, 400));
    expect(err.message).toBe("The request failed.");
    expect(err.status).toBe(400);
  });
});

describe("networkError", () => {
  it("says the request never arrived, and that nothing changed", () => {
    const err = networkError("/api/transition/inventory", new TypeError("Failed to fetch"));
    expect(err.message).toMatch(/could not reach/i);
    expect(err.action).toMatch(/nothing was changed/i);
    expect(err.status).toBe(0);
    expect(err.detail).toContain("TypeError");
  });
});
