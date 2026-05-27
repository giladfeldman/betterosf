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

  it("increments app-token counter only when anonymous is rate-limited and app fallback is used", async () => {
    server.use(
      http.get("https://api.osf.io/v2/nodes/y/", ({ request }) => {
        if (!request.headers.get("authorization")) return new HttpResponse(null, { status: 429 });
        return HttpResponse.json({ data: { id: "y", type: "nodes", attributes: {} } });
      })
    );
    await osfGet("/nodes/y/");
    const today = new Date().toISOString().slice(0, 10);
    expect(await getCount(`app:osf:calls:${today}`)).toBe(1);
  });
});
