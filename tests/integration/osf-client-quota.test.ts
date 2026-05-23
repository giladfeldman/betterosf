import { describe, it, expect, beforeEach } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../msw/server";
import { osfGet } from "@/lib/osf/client";
import { _resetForTests, getCount } from "@/lib/limits";

describe("osfGet quota tracking (anonymous = app token)", () => {
  beforeEach(() => _resetForTests());

  it("increments app:osf:calls counter when using app token", async () => {
    server.use(
      http.get("https://api.osf.io/v2/nodes/x/", () =>
        HttpResponse.json({ data: { id: "x", type: "nodes", attributes: {} } })
      )
    );
    await osfGet("/nodes/x/");
    await osfGet("/nodes/x/");
    const today = new Date().toISOString().slice(0, 10);
    expect(await getCount(`app:osf:calls:${today}`)).toBe(2);
  });
});
