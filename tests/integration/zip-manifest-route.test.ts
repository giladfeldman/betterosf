/**
 * `/api/zip/[guid]/manifest` — the shopping list for a browser-direct whole-tree ZIP.
 *
 * THE FINDING (review, 2026-08-14). This route shipped with **no rate limit**, while the
 * route it replaces caps anonymous callers at 5 per IP per hour. It returns a few KB of
 * JSON, but producing that JSON walks up to 500 nodes at `getNode` + `getProviderRoots`
 * each — up to ~1000 OSF requests per call, made with BetterOSF's **own app token** when the
 * caller is anonymous. Uncapped, it is an amplifier against OSF under a shared credential
 * and a hole in exactly the function budget the browser-direct work exists to protect.
 *
 * Moving the bytes out of the function must not quietly move the cap out with them. The cap
 * therefore shares the ZIP route's key, so a caller cannot take 5 server-assembled ZIPs AND
 * an unlimited number of manifests.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/osf/tree", () => ({ collectNodeTree: vi.fn() }));
vi.mock("@/lib/osf/files", () => ({ getProviderRoots: vi.fn() }));
vi.mock("@/lib/limits", () => ({ incrementWindow: vi.fn() }));
vi.mock("@/auth", () => ({ auth: vi.fn() }));

import { GET } from "@/app/api/zip/[guid]/manifest/route";
import { collectNodeTree } from "@/lib/osf/tree";
import { getProviderRoots } from "@/lib/osf/files";
import { incrementWindow } from "@/lib/limits";
import { auth } from "@/auth";

function call(guid = "abc12") {
  return GET(new Request(`http://localhost:4747/api/zip/${guid}/manifest`), {
    params: Promise.resolve({ guid }),
  });
}

beforeEach(() => {
  // Call history accumulates across tests otherwise, so a `not.toHaveBeenCalled()`
  // assertion would fail on a previous test's call and read as a route defect.
  vi.clearAllMocks();
  vi.mocked(auth).mockResolvedValue(null as never);
  vi.mocked(incrementWindow).mockResolvedValue(1);
  vi.mocked(collectNodeTree).mockResolvedValue([
    { guid: "abc12", title: "Root project", depth: 0, parentPath: "", linked: false },
    { guid: "kid01", title: "A component", depth: 1, parentPath: "Root project", linked: false },
    { guid: "lnk01", title: "Someone else's", depth: 1, parentPath: "", linked: true },
  ]);
  vi.mocked(getProviderRoots).mockResolvedValue([
    { provider: "osfstorage", name: "osfstorage", listingUrl: "l" },
  ] as never);
});

describe("GET /api/zip/[guid]/manifest", () => {
  it("refuses an invalid guid without touching OSF", async () => {
    const res = await call("!!!");
    expect(res.status).toBe(400);
    expect(vi.mocked(collectNodeTree)).not.toHaveBeenCalled();
  });

  it("caps anonymous callers, on the SAME budget as the ZIP route it replaces", async () => {
    vi.mocked(incrementWindow).mockResolvedValue(6);
    const res = await call();

    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("3600");
    // The key is shared with /api/zip/[guid] deliberately — a separate budget would let one
    // caller take 5 server ZIPs and unlimited manifests.
    expect(vi.mocked(incrementWindow)).toHaveBeenCalledWith(
      expect.stringContaining("wholetree-zip"),
      3600,
    );
    // And the expensive part never ran.
    expect(vi.mocked(collectNodeTree)).not.toHaveBeenCalled();
  });

  it("does not spend the anonymous budget on a signed-in caller", async () => {
    vi.mocked(auth).mockResolvedValue({ accessToken: "t" } as never);
    const res = await call();
    expect(res.status).toBe(200);
    expect(vi.mocked(incrementWindow)).not.toHaveBeenCalled();
  });

  it("returns one row per node with the folder name the archive will use", async () => {
    const body = await (await call()).json();

    expect(body.rootTitle).toBe("Root project");
    expect(body.filename).toBe("Root project_abc12.zip");
    expect(body.nodes.map((n: { folder: string }) => n.folder)).toEqual([
      "Root project",
      "Root project/A component_kid01",
      // A linked project is prefixed, so it is never mistaken for the author's own work.
      "Root project/linked_Someone else's_lnk01",
    ]);
    expect(body.nodes[0].providers).toEqual(["osfstorage"]);
  });

  /**
   * Observed in production immediately after v1.12.0 deployed: OSF was rate-limiting, and
   * this route answered **502** for every request. 502 says "the upstream broke"; the truth
   * was a transient 429 with a Retry-After, and the difference is not cosmetic — the
   * browser-direct button falls back to the SERVER route on a generic failure, which is the
   * expensive path that walks OSF harder. Mislabelling a rate limit made the app answer
   * "slow down" with more load.
   */
  it("passes an OSF rate limit through as 429, not a blanket 502", async () => {
    const { OsfError } = await import("@/lib/osf/types");
    vi.mocked(collectNodeTree).mockRejectedValue(
      new OsfError(429, "rate_limited", "OSF rate limit exceeded"),
    );
    const res = await call();

    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("60");
    const body = await res.json();
    expect(body.code).toBe("osf_rate_limited");
    // Actionable, and true: retrying later works, which "the server broke" never implies.
    expect(body.action).toMatch(/wait/i);
  });

  it("passes a missing project through as 404", async () => {
    const { OsfError } = await import("@/lib/osf/types");
    vi.mocked(collectNodeTree).mockRejectedValue(new OsfError(404, "not_found", "nope"));
    const res = await call();
    expect(res.status).toBe(404);
  });

  it("reports an OSF timeout as 504, not as our own 500", async () => {
    // Observed in production: the OSF client's per-attempt AbortSignal fires and rethrows a
    // raw AbortError, which is not an OsfError — so it fell through to the generic branch
    // and blamed BetterOSF for an upstream that was merely slow.
    const abort = new Error("This operation was aborted");
    abort.name = "AbortError";
    vi.mocked(collectNodeTree).mockRejectedValue(abort);
    const res = await call();

    expect(res.status).toBe(504);
    expect((await res.json()).code).toBe("osf_timeout");
  });

  it("still reports a genuine bug as ours, not as OSF's", async () => {
    vi.mocked(collectNodeTree).mockRejectedValue(new TypeError("x is not a function"));
    const res = await call();
    // 500, not 502: a programming error must not be disguised as an upstream outage, or an
    // OSF status page becomes the first place someone looks for our bug.
    expect(res.status).toBe(500);
    expect((await res.json()).code).toBe("manifest_failed");
  });

  it("reports a node whose providers could not be listed, rather than dropping it", async () => {
    vi.mocked(getProviderRoots).mockImplementation(async (guid: string) => {
      if (guid === "kid01") throw new Error("OSF said 403");
      return [{ provider: "osfstorage", name: "osfstorage", listingUrl: "l" }] as never;
    });
    const body = await (await call()).json();

    const kid = body.nodes.find((n: { guid: string }) => n.guid === "kid01");
    expect(kid.error).toMatch(/403/);
    expect(kid.providers).toEqual([]);
    // Still present: a silently missing node would make the ZIP quietly incomplete.
    expect(body.nodes).toHaveLength(3);
  });
});
