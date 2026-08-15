/**
 * A page nothing links to is not shipped.
 *
 * THE DEFECT, v1.10.0 (2026-08-13): v1.8.0 and v1.9.0 built the export and the Zenodo
 * transfer at `/transition/[guid]`, tested them, and deployed them — and **nothing in the
 * app ever linked there**. The only way in was to type the URL. The user found out by
 * asking "where is the actual transitioning?" while looking at the finished inventory.
 *
 * Every unit was genuinely correct: the page rendered, the routes worked, the tests passed.
 * The defect was the absence of an edge in the navigation graph, and no per-unit check can
 * see that. It is the UI form of a rule this project already had — *a module imported only
 * by its own test is not shipped*.
 *
 * The v1.10.0 lesson prescribed this test verbatim: "Add a test that fails when the last
 * link is removed, and verify it by removing the link." Verified that way on 2026-08-14 by
 * deleting the `/transition/${project.guid}` href from InventoryTable.tsx and watching this
 * file go red.
 *
 * SCOPE, stated honestly. This is a floor, not a proof:
 *   - It checks that *some* file outside the route's own subtree mentions the path. It
 *     cannot tell that the link is on a page a signed-out user can actually get to, nor
 *     that it renders rather than sitting behind a dead feature flag.
 *   - A catch-all segment matches greedily, so a deep route can be satisfied by a link to a
 *     more specific sibling.
 * It still catches the thing that actually happened, which was zero links, anywhere.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve, relative, join } from "node:path";

const root = resolve(__dirname, "../..");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const srcFiles = walk(resolve(root, "src")).filter((f) => /\.tsx?$/.test(f));
const pages = srcFiles
  .filter((f) => relative(root, f).replace(/\\/g, "/").match(/^src\/app\/.*\/page\.tsx$/))
  .map((f) => relative(root, f).replace(/\\/g, "/"))
  .sort();

/** "src/app/transition/[guid]/page.tsx" -> "/transition/[guid]" */
const routeOf = (page: string) => "/" + page.slice("src/app/".length, -"/page.tsx".length);

/** The directory whose files count as self-links and are therefore excluded. */
const ownSubtree = (page: string) => page.slice(0, -"page.tsx".length);

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * A route becomes the pattern an inbound link would have to contain.
 *   /about                  -> /about followed by a string boundary
 *   /transition/[guid]      -> /transition/${...}
 *   /[guid]/files/[...path] -> /${...}/files/<anything>
 */
function linkPattern(route: string): RegExp {
  const segs = route.split("/").filter(Boolean);
  let dynamic = false;
  const parts = segs.map((seg) => {
    if (/^\[\[?\.\.\..+?\]\]?$/.test(seg)) {
      dynamic = true;
      return "[^\"'`]+"; // catch-all: one or more segments, inside one string literal
    }
    if (/^\[.+\]$/.test(seg)) {
      dynamic = true;
      return "\\$\\{[^}]*\\}"; // a template hole
    }
    return escape(seg);
  });
  // The path must START a string literal (or follow an interpolation, as in
  // `${base}/transition/${guid}`). Without this, `/api/transition/${id}` inside an API
  // client would satisfy the page route `/transition/[guid]` — a fetch is not a link, and
  // counting one would hand back exactly the false green this test exists to prevent.
  const body = "(?<=[\"'`}])/" + parts.join("/");
  // A static route also needs a trailing boundary, so /about is not satisfied by /aboutus.
  // A dynamic one already ends in something distinctive enough not to need one.
  return new RegExp(dynamic ? body : body + "[\"'`?#]");
}

/** A page whose whole job is redirecting somewhere else is a legacy alias, and legacy
 *  aliases exist precisely so that nothing has to link to them. Auto-detected rather than
 *  allowlisted, so the exemption cannot be borrowed by a real page. */
function isRedirectOnly(page: string): boolean {
  const text = readFileSync(resolve(root, page), "utf8");
  return /\bredirect\(/.test(text) && !/return\s*\(/.test(text);
}

describe("every page route has a way in", () => {
  it("found the app's pages at all (a zero-length scan would pass every assertion below)", () => {
    expect(pages.length).toBeGreaterThan(15);
  });

  for (const page of pages) {
    const route = routeOf(page);

    if (route === "/") {
      it(`${route} is the entry point, nothing to link`, () => expect(true).toBe(true));
      continue;
    }

    if (isRedirectOnly(page)) {
      it(`${route} is a redirect-only legacy alias, exempt by construction`, () => {
        expect(readFileSync(resolve(root, page), "utf8")).toMatch(/redirect\(/);
      });
      continue;
    }

    it(`${route} is linked from somewhere outside its own subtree`, () => {
      const pattern = linkPattern(route);
      const mine = ownSubtree(page);
      const linkers = srcFiles
        .map((f) => relative(root, f).replace(/\\/g, "/"))
        .filter((f) => !f.startsWith(mine))
        .filter((f) => pattern.test(readFileSync(resolve(root, f), "utf8")));

      expect(
        linkers,
        `No file under src/ links to ${route}. A page nothing links to is not shipped — ` +
          `the user's only way in is to type the URL. Add a link from a page a user can ` +
          `actually reach (searched for /${pattern.source}/), or, if the route is a ` +
          `deliberate legacy alias, make it a redirect-only page.`,
      ).not.toHaveLength(0);
    });
  }
});
