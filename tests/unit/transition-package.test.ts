// BagIt tag files and RO-Crate metadata.
//
// These are the parts of the export that outlive the session. If Payload-Oxum is wrong,
// every future integrity check on the archive is wrong; if the disclaimer is missing, an
// archive opened in 2031 carries no statement of what its checksums do and do not prove.

import { describe, it, expect } from "vitest";
import {
  payloadOxum,
  renderManifest,
  renderBagInfo,
  renderBagitTxt,
  renderDisclaimer,
  buildBagTagFiles,
  encodeManifestPath,
  type BagFile,
  type BagInfo,
} from "@/lib/transition/package-bagit";
import { buildRoCrate, encodeCrateId } from "@/lib/transition/ro-crate";
import type { ContributorView } from "@/lib/osf/contributors";

const FILES: BagFile[] = [
  { path: "osfstorage/b.csv", size: 200, sha256: "bbb", md5: "b5" },
  { path: "osfstorage/a.csv", size: 100, sha256: "aaa", md5: "a5" },
];

const INFO: BagInfo = {
  projectTitle: "Many Labs 2",
  projectGuid: "8cd4r",
  osfUrl: "https://osf.io/8cd4r/",
  createdAt: "2026-08-13T10:00:00.000Z",
  appVersion: "1.8.0",
};

describe("payloadOxum", () => {
  it("is total octets dot file count", () => {
    expect(payloadOxum(FILES)).toBe("300.2");
  });

  it("is 0.0 for an empty payload", () => {
    // Honest arithmetic. The EXPORT-level guard against an empty run lives in
    // reconcile(); this field must simply state the truth.
    expect(payloadOxum([])).toBe("0.0");
  });

  it("counts zero-byte files as files", () => {
    expect(payloadOxum([{ path: "empty.txt", size: 0, sha256: "e" }])).toBe("0.1");
  });
});

describe("renderManifest", () => {
  it("writes checksum, two spaces, then the data/ path", () => {
    expect(renderManifest(FILES, "sha256")).toBe(
      "aaa  data/osfstorage/a.csv\nbbb  data/osfstorage/b.csv\n",
    );
  });

  it("sorts so the manifest is byte-stable across runs", () => {
    const reversed = renderManifest([...FILES].reverse(), "sha256");
    expect(reversed).toBe(renderManifest(FILES, "sha256"));
  });

  it("omits files with no checksum for that algorithm", () => {
    const out = renderManifest([{ path: "x", size: 1, sha256: "s", md5: null }], "md5");
    expect(out).toBe("");
  });

  it("is empty, not malformed, when there is nothing to list", () => {
    expect(renderManifest([], "sha256")).toBe("");
  });

  it("percent-encodes newlines so a filename cannot forge a manifest line", () => {
    // RFC 8493 requires this. Without it, a file named "a\nffff  data/evil" would add a
    // fabricated entry to a line-oriented manifest.
    const out = renderManifest([{ path: "a\nb.csv", size: 1, sha256: "s" }], "sha256");
    expect(out).toBe("s  data/a%0Ab.csv\n");
    expect(out.trim().split("\n")).toHaveLength(1);
  });

  it("escapes an existing percent so encoding round-trips unambiguously", () => {
    expect(encodeManifestPath("100%.csv")).toBe("100%25.csv");
  });
});

describe("bagit.txt", () => {
  it("declares the version and encoding required by RFC 8493", () => {
    expect(renderBagitTxt()).toContain("BagIt-Version: 1.0");
    expect(renderBagitTxt()).toContain("Tag-File-Character-Encoding: UTF-8");
  });
});

describe("bag-info.txt", () => {
  it("carries Payload-Oxum and the source identifier", () => {
    const out = renderBagInfo(INFO, FILES);
    expect(out).toContain("Payload-Oxum: 300.2");
    expect(out).toContain("External-Identifier: https://osf.io/8cd4r/");
  });

  it("says complete when the export was complete", () => {
    expect(renderBagInfo(INFO, FILES)).toContain("BetterOSF-Export-Status: complete");
  });

  it("records INCOMPLETE inside the bag, not just on screen", () => {
    // An incomplete archive that travels without saying so is the artefact most likely
    // to be mistaken for a complete one years later.
    const out = renderBagInfo({ ...INFO, incompleteReason: "3 files failed" }, FILES);
    expect(out).toContain("BetterOSF-Export-Status: INCOMPLETE — 3 files failed");
  });

  it("keeps every tag on one line even with a multi-line title", () => {
    const out = renderBagInfo({ ...INFO, projectTitle: "Bad\nTitle\r\nHere" }, FILES);
    const desc = out.split("\n").filter((l) => l.startsWith("External-Description:"));
    expect(desc).toHaveLength(1);
    expect(desc[0]).toContain("Bad Title Here");
  });
});

describe("DISCLAIMER.txt", () => {
  const text = renderDisclaimer(INFO);

  it("states that BetterOSF never deleted anything to make the export", () => {
    expect(text).toMatch(/did NOT delete/);
  });

  it("states it is not a warranty", () => {
    expect(text).toMatch(/NOT a warranty/i);
  });

  it("explains what unverifiable means and why", () => {
    expect(text).toMatch(/unverifiable/);
    expect(text).toMatch(/Dropbox, Google Drive or S3/);
  });

  it("disclaims affiliation with COS and OSF", () => {
    expect(text).toMatch(/not affiliated/i);
  });

  it("links the full terms and names the version", () => {
    expect(text).toMatch(/betterosf\.vercel\.app\/terms/);
  });
});

describe("buildBagTagFiles", () => {
  it("always includes the disclaimer alongside the manifests", () => {
    const tags = buildBagTagFiles(INFO, FILES);
    expect(Object.keys(tags).sort()).toEqual([
      "DISCLAIMER.txt",
      "bag-info.txt",
      "bagit.txt",
      "manifest-md5.txt",
      "manifest-sha256.txt",
    ]);
    expect(tags["DISCLAIMER.txt"].length).toBeGreaterThan(100);
  });
});

describe("buildRoCrate", () => {
  function contributor(over: Partial<ContributorView> = {}): ContributorView {
    return {
      id: "8cd4r-tmwry",
      userId: "tmwry",
      fullName: "Richard A. Klein",
      givenName: "Richard",
      familyName: "Klein",
      orcid: "0000-0002-8713-1972",
      orcidStatus: "VERIFIED",
      index: 0,
      bibliographic: true,
      permission: "admin",
      unregistered: false,
      ...over,
    };
  }

  const input = {
    projectGuid: "8cd4r",
    title: "Many Labs 2",
    description: "A replication project",
    osfUrl: "https://osf.io/8cd4r/",
    doi: "10.17605/OSF.IO/8CD4R",
    datePublished: "2014-09-16",
    dateModified: "2022-02-16",
    keywords: ["replication"],
    license: { name: "CC0 1.0", url: "https://creativecommons.org/publicdomain/zero/1.0/" },
    contributors: [contributor()],
    files: [{ path: "osfstorage/a.csv", size: 100, sha256: "aaa", contentType: "text/csv" }],
    wikiPages: [{ name: "Home", path: "wikis/Home.md" }],
    appVersion: "1.8.0",
    createdAt: "2026-08-13T10:00:00.000Z",
  };

  it("uses a verified ORCID as the person's identity", () => {
    const crate = buildRoCrate(input);
    const person = crate["@graph"].find((e) => e["@type"] === "Person") as Record<string, unknown>;
    expect(person["@id"]).toBe("https://orcid.org/0000-0002-8713-1972");
  });

  it("does NOT assert an unverified ORCID, and says why", () => {
    const crate = buildRoCrate({
      ...input,
      contributors: [contributor({ orcid: null, orcidStatus: "CREATE" })],
    });
    const person = crate["@graph"].find((e) => e["@type"] === "Person") as Record<string, unknown>;
    expect(person["@id"]).toBe("https://osf.io/tmwry/");
    expect(String(person.description)).toMatch(/not verified/i);
  });

  it("records non-bibliographic contributors, who have no DataCite home", () => {
    const crate = buildRoCrate({
      ...input,
      contributors: [contributor(), contributor({ id: "x", userId: "u2", bibliographic: false, orcid: null, fullName: "Helper" })],
    });
    const people = crate["@graph"].filter((e) => e["@type"] === "Person");
    expect(people).toHaveLength(2);
    expect(JSON.stringify(people)).toMatch(/Non-bibliographic/);
  });

  it("lists only bibliographic contributors as authors", () => {
    const crate = buildRoCrate({
      ...input,
      contributors: [contributor(), contributor({ id: "x", bibliographic: false, orcid: null })],
    });
    const root = crate["@graph"].find((e) => e["@id"] === "./") as Record<string, unknown>;
    expect(root.author).toHaveLength(1);
  });

  it("marks an unverifiable file in the crate, not only in the report", () => {
    const crate = buildRoCrate({
      ...input,
      files: [{ path: "dropbox/x.csv", size: 5, sha256: null, verification: "unverifiable" }],
    });
    const file = crate["@graph"].find((e) => String(e["@id"]).includes("dropbox"));
    expect(String((file as Record<string, unknown>).description)).toMatch(/no checksum/i);
  });

  it("describes wiki pages, noting OSF has no wiki export", () => {
    const crate = buildRoCrate(input);
    const wiki = crate["@graph"].find((e) => String(e["@id"]).includes("wikis/"));
    expect(String((wiki as Record<string, unknown>).description)).toMatch(/no wiki export/i);
  });

  it("declares RO-Crate 1.1 conformance", () => {
    const crate = buildRoCrate(input);
    expect(crate["@context"]).toBe("https://w3id.org/ro/crate/1.1/context");
    const meta = crate["@graph"][0] as Record<string, unknown>;
    expect(meta["@id"]).toBe("ro-crate-metadata.json");
  });

  it("prefers the DOI as the root identifier when there is one", () => {
    const root = buildRoCrate(input)["@graph"].find((e) => e["@id"] === "./") as Record<string, unknown>;
    expect(root.identifier).toBe("https://doi.org/10.17605/OSF.IO/8CD4R");
  });

  it("falls back to the OSF URL when there is no DOI", () => {
    const root = buildRoCrate({ ...input, doi: null })["@graph"].find(
      (e) => e["@id"] === "./",
    ) as Record<string, unknown>;
    expect(root.identifier).toBe("https://osf.io/8cd4r/");
  });
});

describe("encodeCrateId", () => {
  it("encodes spaces and hashes but keeps path separators", () => {
    expect(encodeCrateId("Wiki images/a b#1.png")).toBe("Wiki%20images/a%20b%231.png");
  });
});
