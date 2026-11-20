/**
 * d-e301b8: the class sweep of d-760cbc. Which OSF free-text fields arrive HTML-escaped,
 * MEASURED with anonymous GETs against api.osf.io on 2026-11-19 (not assumed):
 *
 *   field                       escaped?  evidence
 *   users.full_name             YES       /v2/users/?filter[full_name]=& -> "B&amp;A SMART HOME" (2gzn5),
 *                                         "Social &amp; AI Accounts Store" (637tr)
 *   users.given_name            YES       /v2/users/2gzn5/ -> given_name "B&amp;A"
 *   users.family_name           (same serializer as given_name; decoded alongside it)
 *   nodes.tags                  YES       /v2/nodes/?filter[tags]=R%26amp%3BD -> 10 hits, tag "Inclusive R&amp;D"
 *                                         (dqkh9); filter[tags]=R%26D -> 0 hits
 *   files.name / materialized_path  NO    /v2/files/s9jm7/ -> "R&D focus.txt", "/R&D focus.txt" (raw)
 *   apostrophe / double quote   NO        full_name "Harry O'Brien" (wbueg); title "Code&amp;Dataset for 'Prefrontal…"
 *                                         (ve6zy): only & < > are escaped, ' and " are raw
 *   wiki page names             YES       POST a wiki named 'R&D <b> "q" probe' on the throwaway account
 *                                         (wf83z, wiki 34sqv, 2026-11-19) -> read back as 'R&amp;D  "q" probe'
 *
 * File names are NOT decoded: a file literally named "a&amp;b.txt" must keep its name, and
 * decoding a raw field would corrupt it.
 */
import { describe, it, expect } from "vitest";
import { parseNode } from "@/lib/osf/parse";
import { parseContributor } from "@/lib/osf/contributors";
import { preprintAuthorNames } from "@/lib/osf/preprints";
import { osfProvider } from "@/lib/auth/osf-provider";
import { decodeOsfText } from "@/lib/osf/decode-text";

describe("measured-escaped fields are decoded once at parse", () => {
  it("node tags", () => {
    const n = parseNode({ data: { id: "dqkh9", attributes: { title: "t", tags: ["Inclusive R&amp;D", "plain"] } } });
    expect(n.tags).toEqual(["Inclusive R&D", "plain"]);
  });

  it("contributor full, given and family names (registered user)", () => {
    const c = parseContributor({
      id: "abcde-2gzn5",
      attributes: { index: 0, bibliographic: true, permission: "admin" },
      embeds: { users: { data: { id: "2gzn5", attributes: { full_name: "B&amp;A SMART HOME", given_name: "B&amp;A", family_name: "HOME" } } } },
    } as never);
    expect(c.fullName).toBe("B&A SMART HOME");
    expect(c.givenName).toBe("B&A");
    expect(c.familyName).toBe("HOME");
  });

  it("an apostrophe OSF sends raw stays as it is", () => {
    const c = parseContributor({
      id: "abcde-wbueg",
      attributes: {},
      embeds: { users: { data: { id: "wbueg", attributes: { full_name: "Harry O'Brien" } } } },
    } as never);
    expect(c.fullName).toBe("Harry O'Brien");
  });

  it("preprint author names", () => {
    expect(
      preprintAuthorNames({
        data: [
          { embeds: { users: { data: { attributes: { full_name: "Social &amp; AI Accounts Store" } } } } },
          { embeds: { users: { data: { attributes: {} } } } },
        ],
      }),
    ).toEqual(["Social & AI Accounts Store"]);
  });

  it("the signed-in display name", () => {
    const config = osfProvider({ clientId: "cid", clientSecret: "csecret" });
    const profile = config.profile?.(
      { data: { id: "2gzn5", type: "users", attributes: { full_name: "B&amp;A SMART HOME" } } },
      undefined as never,
    );
    expect(profile).toMatchObject({ name: "B&A SMART HOME" });
  });
});

describe("a C1 control character is not produced (measured: full_name 'FÃ&#137;LIX', 68t9k)", () => {
  it("&#137; (U+0089) stays as the entity", () => {
    expect(decodeOsfText("F&#137;LIX")).toBe("F&#137;LIX");
    expect(decodeOsfText("&#159;")).toBe("&#159;");
    expect(decodeOsfText("&#160;")).toBe(" ");
  });
});
