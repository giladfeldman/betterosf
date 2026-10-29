import { describe, it, expect } from "vitest";
import { DESTINATIONS, renderLicenceFile, suggestDestination } from "@/lib/transition/destination-guide";

describe("suggestDestination (Lakens rules)", () => {
  it("never sends pseudonymised data to Zenodo, whatever the other answers", () => {
    for (const content of ["code", "data-materials"] as const) {
      for (const style of ["point-and-click", "either"] as const) {
        const s = suggestDestination({ data: "pseudonymised", content, style });
        expect(s.primary.id).toBe("dataverse-nl");
        expect([s.primary, ...s.alternatives].map((d) => d.id)).not.toContain("zenodo");
      }
    }
  });

  it("code → GitHub linked to Zenodo", () => {
    expect(suggestDestination({ data: "anonymised-or-none", content: "code", style: "either" }).primary.id).toBe("github");
  });

  it("point-and-click data → ResearchBox; otherwise Zenodo", () => {
    expect(suggestDestination({ data: "anonymised-or-none", content: "data-materials", style: "point-and-click" }).primary.id).toBe("researchbox");
    expect(suggestDestination({ data: "anonymised-or-none", content: "data-materials", style: "either" }).primary.id).toBe("zenodo");
  });

  it("only Zenodo claims an automatic transfer (the only destination BetterOSF uploads to)", () => {
    expect(Object.values(DESTINATIONS).filter((d) => d.automatic).map((d) => d.id)).toEqual(["zenodo"]);
  });
});

describe("renderLicenceFile", () => {
  const project = { title: "Study 1", osfUrl: "https://osf.io/awt3q/" };
  const base = { text: null, copyrightHolders: [], year: null };
  it("writes the licence name, copyright line and OSF's licence text", () => {
    const text = renderLicenceFile(
      { name: "MIT License", text: "Permission is hereby granted...", copyrightHolders: ["Jane Doe"], year: "2024" },
      project,
    );
    expect(text).toContain("Licensed under: MIT License");
    expect(text).toContain("Copyright 2024 Jane Doe");
    expect(text).toContain("Permission is hereby granted...");
  });
  it("omits the copyright line when OSF has none", () => {
    expect(renderLicenceFile({ ...base, name: "CC0 1.0 Universal" }, project)).not.toContain("Copyright");
  });
  it("writes nothing when OSF asserts no reuse licence", () => {
    expect(renderLicenceFile(null, project)).toBeNull();
    expect(renderLicenceFile({ ...base, name: "No license" }, project)).toBeNull();
    expect(renderLicenceFile({ ...base, name: "Other" }, project)).toBeNull();
  });
});
