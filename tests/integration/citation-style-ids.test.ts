/**
 * OSF names citation styles by CSL id, and `mla` is not one: OSF answers
 * `404 "mla.csl is not a known style."` (measured live 2026-10-29). The MLA
 * format had been requested as `mla` since the panel shipped, and the route's
 * per-format `.catch(() => "")` hid the 404 — MLA was silently empty for every
 * project. Once d-318f33 stopped swallowing errors, that same 404 failed the
 * whole citation panel; the local signed-in probe caught it before release.
 *
 * The mock below answers only the ids measured as valid against live OSF on
 * 2026-10-29 and 404s anything else, exactly as OSF does.
 */
import { describe, it, expect } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../msw/server";
import { getStyledCitation } from "@/lib/osf/citation";

const LIVE_VERIFIED_STYLE_IDS = new Set(["apa", "modern-language-association-8th-edition", "chicago-author-date"]);

describe("getStyledCitation asks OSF for style ids OSF actually knows", () => {
  it.each(["apa", "mla", "chicago-author-date"] as const)("%s resolves to a known OSF style", async (style) => {
    server.use(
      http.get("https://api.osf.io/v2/nodes/:guid/citation/:style/", ({ params }) => {
        const id = String(params.style);
        if (!LIVE_VERIFIED_STYLE_IDS.has(id)) {
          return HttpResponse.json({ errors: [{ detail: `${id}.csl is not a known style.` }] }, { status: 404 });
        }
        return HttpResponse.json({ data: { id, type: "styled-citations", attributes: { citation: `cited as ${id}` } } });
      }),
    );
    await expect(getStyledCitation("ab12c", style)).resolves.toMatch(/^cited as /);
  });
});
