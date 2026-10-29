/**
 * d-08edd3 sweep: the sibling READ routes that call OSF must report a timeout or a network
 * failure as an upstream problem (504 / 502), never as a BetterOSF 500.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const collectNodeTree = vi.fn();
vi.mock("@/lib/osf/tree", () => ({ collectNodeTree: (...a: unknown[]) => collectNodeTree(...a) }));
vi.mock("@/lib/osf/files", () => ({ getProviderRoots: vi.fn() }));
vi.mock("@/lib/transition/guard", () => ({
  requireTransitionActor: async () => ({ ok: true, actor: { userId: "u1", osfUserId: "osf1" } }),
  guardResponse: () => new Response(null, { status: 401 }),
}));
vi.mock("@/lib/osf/tokens", () => ({ selectToken: async () => "tok" }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("OSF timeouts on read routes are 504, not 500", () => {
  it("/api/zip/[guid]: a timeout walking the node tree is 504", async () => {
    collectNodeTree.mockRejectedValue(new DOMException("aborted", "AbortError"));
    const { GET } = await import("@/app/api/zip/[guid]/route");
    const res = await GET(new Request("http://localhost:4747/api/zip/ezcuj") as never, {
      params: Promise.resolve({ guid: "ezcuj" }),
    });
    expect(res.status).toBe(504);
  }, 20_000);

  it("/api/transition/wiki/[id]: a network failure reaching OSF is 502 JSON, not an unhandled 500", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fetch failed"); }));
    const { GET } = await import("@/app/api/transition/wiki/[wikiId]/route");
    const res = await GET(new Request("http://localhost:4747/api/transition/wiki/abc12"), {
      params: Promise.resolve({ wikiId: "abc12" }),
    });
    expect(res.status).toBe(502);
  });

  it("/api/transition/wiki/[id]: a timeout is 504", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new DOMException("aborted", "AbortError"); }));
    const { GET } = await import("@/app/api/transition/wiki/[wikiId]/route");
    const res = await GET(new Request("http://localhost:4747/api/transition/wiki/abc12"), {
      params: Promise.resolve({ wikiId: "abc12" }),
    });
    expect(res.status).toBe(504);
  });
});
