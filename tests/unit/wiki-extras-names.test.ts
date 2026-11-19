/**
 * d-d7a103 (project-review R-0156): wiki names were sanitised by a local `safeName`
 * (`[^\w. -]` → `_`, ASCII-only `\w`), not by the shared sanitiser. Three wikis named in a
 * non-Latin script — "研究", "数据", "方法" — all became `wikis/_.md`. The ZIP held ONE of
 * them, and all three were still hashed and listed as verified.
 *
 * Pinned here: every fetched wiki gets its own entry (case-insensitively unique, because
 * Windows and macOS filesystems fold case), names go through `safeNameSegment`, and the
 * RO-Crate keeps the wiki's real name rather than the rewritten file name.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchExtras } from "@/components/transition/plan-extras";
import { wikiPagesFromExtras } from "@/lib/transition/ro-crate";
import type { PlanResponse } from "@/components/transition/plan-types";

function planWith(wikis: { id: string; name: string }[]): PlanResponse {
  return {
    guid: "abcde",
    wikis: wikis.map((w) => ({ ...w, size: 10 })),
  } as unknown as PlanResponse;
}

afterEach(() => vi.unstubAllGlobals());

function stubWikiFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => new Response(`content of ${String(url).split("/").pop()}`)),
  );
}

describe("wiki pages in an export never collapse into one entry", () => {
  it("three non-Latin wiki names produce three distinct entries", async () => {
    stubWikiFetch();
    const { extras } = await fetchExtras(
      planWith([
        { id: "w1", name: "研究" },
        { id: "w2", name: "数据" },
        { id: "w3", name: "方法" },
      ]),
    );
    const wikis = extras.filter((e) => e.path.startsWith("wikis/"));
    expect(wikis).toHaveLength(3);
    expect(new Set(wikis.map((w) => w.path)).size).toBe(3);
    // Each entry carries its own wiki's text — nothing was overwritten.
    expect(new Set(wikis.map((w) => w.text)).size).toBe(3);
  });

  it("names that differ only by case, or sanitise to the same thing, stay distinct", async () => {
    stubWikiFetch();
    const { extras } = await fetchExtras(
      planWith([
        { id: "w1", name: "Home" },
        { id: "w2", name: "home" },
        { id: "w3", name: "a<b" },
        { id: "w4", name: "a>b" },
      ]),
    );
    const paths = extras.filter((e) => e.path.startsWith("wikis/")).map((e) => e.path.toLowerCase());
    expect(new Set(paths).size).toBe(4);
  });

  it("uses the shared sanitiser: a Windows-reserved or illegal name is rewritten, not dropped", async () => {
    stubWikiFetch();
    const { extras } = await fetchExtras(planWith([{ id: "w1", name: "CON" }, { id: "w2", name: 'q"uote?' }]));
    const paths = extras.filter((e) => e.path.startsWith("wikis/")).map((e) => e.path);
    expect(paths).toContain("wikis/_CON.md");
    expect(paths).toContain("wikis/q-uote-.md");
  });

  it("the RO-Crate names each wiki by its real OSF name", async () => {
    stubWikiFetch();
    const { extras } = await fetchExtras(planWith([{ id: "w1", name: "研究" }, { id: "w2", name: "数据" }]));
    const pages = wikiPagesFromExtras(extras, "data/");
    expect(pages.map((p) => p.name).sort()).toEqual(["数据", "研究"].sort());
    expect(pages.every((p) => p.path.startsWith("data/wikis/"))).toBe(true);
  });
});

describe("a wiki page that fails to fetch is named, never silently dropped (d-927519)", () => {
  it("an OSF error and a network failure each produce a 'missing' line naming the page", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).endsWith("/w2")) return new Response("bad gateway", { status: 502 });
        if (String(url).endsWith("/w3")) throw new TypeError("Failed to fetch");
        return new Response("ok");
      }),
    );
    const { extras, missing } = await fetchExtras(
      planWith([{ id: "w1", name: "Home" }, { id: "w2", name: "Methods" }, { id: "w3", name: "Data" }]),
    );
    expect(extras.filter((e) => e.path.startsWith("wikis/"))).toHaveLength(1);
    expect(missing).toHaveLength(2);
    expect(missing[0]).toContain('"Methods"');
    expect(missing[0]).toContain("502");
    expect(missing[1]).toContain('"Data"');
  });

  it("nothing is missing when every page arrives", async () => {
    stubWikiFetch();
    const { missing } = await fetchExtras(planWith([{ id: "w1", name: "Home" }]));
    expect(missing).toEqual([]);
  });
});

describe("a failed lookup is missing content, not 'none' (review 2026-11-18)", () => {
  it("wikis: null (the wiki list could not be read) produces a missing line", async () => {
    stubWikiFetch();
    const { missing } = await fetchExtras({ guid: "abcde", wikis: null } as unknown as PlanResponse);
    expect(missing.some((m) => m.includes("wiki pages could not be read"))).toBe(true);
  });

  it("contributors: null produces a missing line", async () => {
    stubWikiFetch();
    const { missing } = await fetchExtras({ guid: "abcde", wikis: [], contributors: null } as unknown as PlanResponse);
    expect(missing.some((m) => m.includes("contributor list could not be read"))).toBe(true);
  });

  it("control: an empty wiki list and a known contributor list are not missing", async () => {
    stubWikiFetch();
    const { missing } = await fetchExtras({ guid: "abcde", wikis: [], contributors: [] } as unknown as PlanResponse);
    expect(missing).toEqual([]);
  });
});
