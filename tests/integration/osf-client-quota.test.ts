import { describe, it, expect, beforeEach } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../msw/server";
import { osfGet } from "@/lib/osf/client";
import { _resetForTests, getCount } from "@/lib/limits";

describe("osfGet quota tracking", () => {
  beforeEach(() => _resetForTests());

  it("does not increment app-token counter for anonymous public cache hits", async () => {
    server.use(
      http.get("https://api.osf.io/v2/nodes/x/", () =>
        HttpResponse.json({ data: { id: "x", type: "nodes", attributes: {} } })
      )
    );
    await osfGet("/nodes/x/");
    await osfGet("/nodes/x/");
    const today = new Date().toISOString().slice(0, 10);
    expect(await getCount(`app:osf:calls:${today}`)).toBe(0);
  });

  // d-ff4462: the app-token fallback is gone. A rate-limited anonymous read is reported as
  // OSF's 429; it is never retried with a shared credential, and nothing is counted.
  it("an anonymous 429 is reported as rate_limited, with no credentialed retry", async () => {
    const auths: (string | null)[] = [];
    server.use(
      http.get("https://api.osf.io/v2/nodes/y/", ({ request }) => {
        auths.push(request.headers.get("authorization"));
        if (!request.headers.get("authorization")) return new HttpResponse(null, { status: 429 });
        return HttpResponse.json({ data: { id: "y", type: "nodes", attributes: {} } });
      })
    );
    await expect(osfGet("/nodes/y/")).rejects.toMatchObject({ status: 429, code: "rate_limited" });
    expect(auths.length).toBeGreaterThan(0);
    expect(auths.every((a) => a === null)).toBe(true);
    const today = new Date().toISOString().slice(0, 10);
    expect(await getCount(`app:osf:calls:${today}`)).toBe(0);
  });
});
