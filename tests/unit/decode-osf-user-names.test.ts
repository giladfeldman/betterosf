/**
 * d-e301b8: user names OSF returns HTML-escaped (full_name "B&amp;A SMART HOME", given_name
 * "B&amp;A", user 2gzn5, measured 2026-11-19 via GET /v2/users/2gzn5/) are decoded in every
 * user parser: profile pages (getUser, getCurrentUser) and user search. See
 * decode-osf-other-fields.test.ts for the full measurement table.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const osfGet = vi.fn();
vi.mock("@/lib/osf/client", () => ({ osfGet: (...a: unknown[]) => osfGet(...a), osfGetUrl: (...a: unknown[]) => osfGet(...a) }));

import { getUser, getCurrentUser } from "@/lib/osf/users";
import { searchUsers } from "@/lib/osf/search";

const escaped = { id: "2gzn5", type: "users", attributes: { full_name: "B&amp;A SMART HOME", given_name: "B&amp;A", family_name: "HOME" } };

beforeEach(() => osfGet.mockReset());

describe("user names are decoded", () => {
  it("getUser", async () => {
    osfGet.mockResolvedValue({ data: escaped });
    expect((await getUser("2gzn5")).fullName).toBe("B&A SMART HOME");
  });
  it("getCurrentUser, including the given+family fallback", async () => {
    osfGet.mockResolvedValue({ data: { ...escaped, attributes: { given_name: "B&amp;A", family_name: "HOME" } } });
    expect((await getCurrentUser()).fullName).toBe("B&A HOME");
  });
  it("searchUsers", async () => {
    osfGet.mockResolvedValue({ data: [escaped], links: { next: null, meta: { total: 1 } }, meta: { total: 1 } });
    const page = await searchUsers("B&A");
    expect(page.results.map((u) => u.fullName)).toEqual(["B&A SMART HOME"]);
  });
});
