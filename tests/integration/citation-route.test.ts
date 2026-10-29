/**
 * d-318f33 (project-review R-0118): the citation route swallowed every OSF
 * failure into "" / null and answered 200. An expired OSF token therefore
 * produced an EMPTY citation panel ("No citation metadata available") — a
 * failure dressed as a fact — and that empty answer carried
 * `Cache-Control: public, max-age=300`, so it stuck for five minutes.
 *
 * Pinned here:
 *   - an OSF 401 reaches the user as 401 "connection expired, sign in again";
 *   - every other OSF failure keeps its real status (403/404/429/502);
 *   - an OSF timeout is a 504, not a 500;
 *   - no error response is ever cacheable;
 *   - a signed-in success is `private`, never `public`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { OsfError } from "@/lib/osf/types";
import { auth } from "@/auth";

const getCitation = vi.fn();
const getStyledCitation = vi.fn();
vi.mock("@/lib/osf/citation", () => ({
  getCitation: (...a: unknown[]) => getCitation(...a),
  getStyledCitation: (...a: unknown[]) => getStyledCitation(...a),
  toBibTeX: () => "@misc{x}",
  toRIS: () => "TY  - DATA",
}));

const authMock = auth as unknown as ReturnType<typeof vi.fn>;

async function call(guid = "ezcuj"): Promise<Response> {
  const { GET } = await import("@/app/api/osf/citation/[guid]/route");
  return GET(new Request(`http://localhost:4747/api/osf/citation/${guid}`), {
    params: Promise.resolve({ guid }),
  });
}

function isCacheable(res: Response): boolean {
  const cc = res.headers.get("Cache-Control") ?? "";
  return !/no-store/.test(cc) && /max-age=\d*[1-9]/.test(cc);
}

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue(null);
  getCitation.mockResolvedValue({ title: "T" });
  getStyledCitation.mockResolvedValue("Styled.");
});

describe("/api/osf/citation/[guid] reports OSF failures honestly (R-0118)", () => {
  it("an expired token (OSF 401) is a 401 asking to sign in again — not a 200 with empty formats", async () => {
    authMock.mockResolvedValue({ accessToken: "tok", user: { id: "u1" } });
    getCitation.mockRejectedValue(new OsfError(401, "unauthorized", "auth required"));
    getStyledCitation.mockRejectedValue(new OsfError(401, "unauthorized", "auth required"));
    const res = await call();
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string; action: string };
    expect(`${body.error} ${body.action}`).toMatch(/sign in again/i);
    expect(isCacheable(res)).toBe(false);
  }, 20_000);

  it("one failing style is enough: a 401 on MLA alone still fails the request", async () => {
    getStyledCitation.mockImplementation(async (_g: string, style: string) => {
      if (style === "mla") throw new OsfError(401, "unauthorized", "auth required");
      return "Styled.";
    });
    const res = await call();
    expect(res.status).toBe(401);
  });

  it.each([
    [403, "forbidden", 403],
    [404, "not_found", 404],
    [429, "rate_limited", 429],
    [503, "upstream", 502],
  ] as const)("OSF %i (%s) keeps its real status %i and is never cached", async (osf, code, want) => {
    getCitation.mockRejectedValue(new OsfError(osf, code, "x"));
    const res = await call();
    expect(res.status).toBe(want);
    expect(isCacheable(res)).toBe(false);
  });

  it("an OSF timeout (AbortError) is a 504, not a 500", async () => {
    getCitation.mockRejectedValue(new DOMException("The operation was aborted.", "AbortError"));
    const res = await call();
    expect(res.status).toBe(504);
    expect(isCacheable(res)).toBe(false);
  });

  it("a non-OSF bug is a 500 and is not cached", async () => {
    getCitation.mockRejectedValue(new TypeError("boom"));
    const res = await call();
    expect(res.status).toBe(500);
    expect(isCacheable(res)).toBe(false);
  });

  it("OSF answering 200 with an empty style is still a success (not an error)", async () => {
    getStyledCitation.mockResolvedValue("");
    const res = await call();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { mla: string };
    expect(body.mla).toBe("");
  });
});

describe("/api/osf/citation/[guid] caching", () => {
  it("anonymous success may be shared-cached", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toMatch(/^public/);
  });

  it("a signed-in success is private, never public (it may describe a private project)", async () => {
    authMock.mockResolvedValue({ accessToken: "tok", user: { id: "u1" } });
    const res = await call();
    expect(res.status).toBe(200);
    const cc = res.headers.get("Cache-Control") ?? "";
    expect(cc).toMatch(/private/);
    expect(cc).not.toMatch(/public/);
  });
});
