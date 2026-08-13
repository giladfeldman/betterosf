// The recommendation engine.
//
// This is the most opinionated code in the toolkit, so its opinions are pinned here.
// The one that matters most: PUBLIC PROJECTS ARE LEFT ALONE. COS keeps them online
// read-only at the same URL and DOI indefinitely, and mirroring them to Zenodo mints a
// second DOI for identical content and splits the citation record. A tool that nudged
// 300 researchers to duplicate their public work would do real harm at scale.

import { describe, it, expect } from "vitest";
import { recommend, ACTIVE_WITHIN_DAYS, ZENODO_MAX_FILES, type ProjectFacts } from "@/lib/transition/recommend";

const NOW = new Date("2026-08-13T00:00:00Z");

function daysAgo(n: number): string {
  return new Date(NOW.getTime() - n * 86_400_000).toISOString();
}

function facts(over: Partial<ProjectFacts> = {}): ProjectFacts {
  return {
    guid: "abc12",
    title: "A project",
    public: true,
    hasDoi: true,
    dateModified: daysAgo(1000),
    storage: { known: true, bytes: 1024 },
    fileCount: 10,
    addonProviders: [],
    wikiCount: 1,
    ...over,
  };
}

describe("public projects", () => {
  it("are left alone", () => {
    const r = recommend(facts(), NOW);
    expect(r.action).toBe("leave");
    expect(r.reasons.join(" ")).toMatch(/read-only public record/i);
  });

  it("cite the second-DOI problem when the project already has one", () => {
    expect(recommend(facts({ hasDoi: true }), NOW).reasons.join(" ")).toMatch(/second DOI/i);
  });

  it("do not claim a DOI status that has not been checked", () => {
    const r = recommend(facts({ hasDoi: null }), NOW);
    expect(r.reasons.join(" ")).toMatch(/has not been checked/i);
    expect(r.reasons.join(" ")).not.toMatch(/second DOI/i);
  });

  it("are STILL left in place when active, with a nudge about ongoing work", () => {
    // The record stays; only the ongoing work needs a new home. Conflating the two is
    // what produces needless duplication.
    const r = recommend(facts({ dateModified: daysAgo(5) }), NOW);
    expect(r.action).toBe("leave");
    expect(r.headline).toMatch(/ongoing work/i);
  });
});

describe("private projects", () => {
  it("that look finished get a verified copy", () => {
    const r = recommend(facts({ public: false, dateModified: daysAgo(1000) }), NOW);
    expect(r.action).toBe("back_up");
    expect(r.reasons.join(" ")).toMatch(/anticipates removing private projects/i);
  });

  it("that are active are moved", () => {
    const r = recommend(facts({ public: false, dateModified: daysAgo(10) }), NOW);
    expect(r.action).toBe("migrate");
  });

  it("mention making it public as the alternative to moving", () => {
    const r = recommend(facts({ public: false, dateModified: daysAgo(1000) }), NOW);
    expect(r.reasons.join(" ")).toMatch(/making it public/i);
  });

  it("switch at the documented activity boundary, not somewhere arbitrary", () => {
    const justActive = recommend(
      facts({ public: false, dateModified: daysAgo(ACTIVE_WITHIN_DAYS) }),
      NOW,
    );
    const justStale = recommend(
      facts({ public: false, dateModified: daysAgo(ACTIVE_WITHIN_DAYS + 1) }),
      NOW,
    );
    expect(justActive.action).toBe("migrate");
    expect(justStale.action).toBe("back_up");
  });

  it("cope with an unparseable modified date without crashing or guessing 'active'", () => {
    const r = recommend(facts({ public: false, dateModified: "not-a-date" }), NOW);
    expect(r.action).toBe("back_up");
    expect(r.reasons.join(" ")).toMatch(/unavailable/i);
  });
});

describe("registrations", () => {
  it("are never actionable — the transition does not touch them", () => {
    const r = recommend(facts({ isRegistration: true, public: false }), NOW);
    expect(r.action).toBe("leave");
    expect(r.reasons.join(" ")).toMatch(/not affected|continues to operate/i);
  });
});

describe("warnings", () => {
  it("flag add-on storage as unverifiable and fragile", () => {
    const r = recommend(facts({ addonProviders: ["dropbox", "github"] }), NOW);
    expect(r.warnings.join(" ")).toMatch(/dropbox, github/);
    expect(r.warnings.join(" ")).toMatch(/unverifiable/i);
  });

  it("say so when the add-on lookup FAILED, instead of implying there are none", () => {
    // [] means "checked, none". null means "could not check". Rendering the second as
    // the first hides the one part of a project whose files cannot be verified.
    const r = recommend(facts({ addonProviders: null }), NOW);
    expect(r.warnings.join(" ")).toMatch(/could not be checked/i);
  });

  it("stay silent when the add-on lookup succeeded and found none", () => {
    expect(recommend(facts({ addonProviders: [] }), NOW).warnings.join(" ")).not.toMatch(
      /third-party storage/i,
    );
  });

  it("say the size is unknown rather than letting it read as zero", () => {
    const r = recommend(facts({ storage: { known: false, reason: "forbidden" } }), NOW);
    expect(r.warnings.join(" ")).toMatch(/Size unknown/i);
  });

  it("do NOT warn about size for a genuinely empty project", () => {
    // 0 bytes is a fact, not a gap.
    const r = recommend(facts({ storage: { known: true, bytes: 0 } }), NOW);
    expect(r.warnings.join(" ")).not.toMatch(/unknown/i);
  });

  it("flag a file count above Zenodo's per-record limit", () => {
    const r = recommend(facts({ fileCount: ZENODO_MAX_FILES + 1 }), NOW);
    expect(r.warnings.join(" ")).toMatch(/packaged into archives/i);
  });

  it("do not flag a file count at exactly the limit", () => {
    expect(recommend(facts({ fileCount: ZENODO_MAX_FILES }), NOW).warnings.join(" ")).not.toMatch(
      /exceeds/i,
    );
  });

  it("flag a project above Zenodo's per-record byte ceiling", () => {
    const r = recommend(facts({ storage: { known: true, bytes: 60 * 1024 ** 3 } }), NOW);
    expect(r.warnings.join(" ")).toMatch(/split across several linked records/i);
  });

  it("attach to a leave-it project too — feasibility is independent of the action", () => {
    const r = recommend(facts({ public: true, addonProviders: ["s3"] }), NOW);
    expect(r.action).toBe("leave");
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it("are empty for an ordinary small project", () => {
    expect(recommend(facts(), NOW).warnings).toEqual([]);
  });
});

describe("every recommendation is explainable", () => {
  it("always carries a headline and at least one reason", () => {
    const cases: Partial<ProjectFacts>[] = [
      {},
      { public: false },
      { public: false, dateModified: daysAgo(2) },
      { isRegistration: true },
      { hasDoi: null },
    ];
    for (const over of cases) {
      const r = recommend(facts(over), NOW);
      expect(r.headline.length).toBeGreaterThan(0);
      expect(r.reasons.length).toBeGreaterThan(0);
    }
  });
});
