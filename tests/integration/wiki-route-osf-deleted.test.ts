/**
 * d-ad230b: the wiki export route turned an OSF 410 (wiki page DELETED on OSF) into a 502,
 * so the export told the user OSF was failing when the page was simply gone. A 410 passes
 * through as 410 with code "osf_deleted" (the rest of the app's contract, osfErrorResponse),
 * and the export records the page as missing BECAUSE it was deleted, not as a fetch failure.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PlanResponse } from "@/components/transition/plan-types";

vi.mock("@/lib/transition/guard", () => ({
  requireTransitionActor: async () => ({ ok: true, actor: { userId: "u1", osfUserId: "osf1" } }),
  guardResponse: () => new Response(null, { status: 401 }),
}));
vi.mock("@/lib/osf/tokens", () => ({
  userTokenOrAnonymous: async () => "tok",
  bearerOrNone: (t: string | undefined) => (t ? { Authorization: `Bearer ${t}` } : {}),
}));

beforeEach(() => vi.unstubAllGlobals());

async function callRoute(status: number) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status })));
  const { GET } = await import("@/app/api/transition/wiki/[wikiId]/route");
  return GET(new Request("http://localhost:4747/api/transition/wiki/abc12"), {
    params: Promise.resolve({ wikiId: "abc12" }),
  });
}

describe("wiki route: OSF 410 is 'deleted on OSF', not an outage", () => {
  it("410 upstream -> 410 with code osf_deleted", async () => {
    const res = await callRoute(410);
    expect(res.status).toBe(410);
    expect((await res.json()).code).toBe("osf_deleted");
  });

  it("404 upstream stays 404; 500 upstream stays 502 (two-sided control)", async () => {
    expect((await callRoute(404)).status).toBe(404);
    expect((await callRoute(500)).status).toBe(502);
  });

  it("export records a deleted wiki page as missing with the 'deleted on OSF' reason", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ code: "osf_deleted" }, { status: 410 })),
    );
    const { fetchExtras } = await import("@/components/transition/plan-extras");
    const plan = { guid: "abcde", wikis: [{ id: "w1", name: "Home", size: 3 }], contributors: [] } as unknown as PlanResponse;
    const { extras, missing } = await fetchExtras(plan);
    expect(extras.some((e) => e.path.startsWith("wikis/"))).toBe(false);
    expect(missing).toHaveLength(1);
    expect(missing[0]).toMatch(/deleted on OSF/);
    expect(missing[0]).not.toMatch(/could not be fetched/);
  });
});
