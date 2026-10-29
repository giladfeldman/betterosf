// Licence check. Fixtures are trimmed from shapes observed on api.osf.io on 2026-10-29:
// `/v2/nodes/?embed=license` (awt3q licensed, 7t8nm none) and `/v2/licenses/` (19 entries).
import { describe, it, expect } from "vitest";
import {
  DEFAULT_LICENCE_ID,
  buildLicencePatch,
  classifyLicence,
  confirmApplied,
  pickableLicences,
  summariseRows,
  toLicenceRow,
  validateApply,
  type LicenceOption,
} from "@/lib/licence/check";

const LICENSED = {
  id: "awt3q",
  attributes: {
    title: "Study 1",
    public: true,
    current_user_permissions: ["read", "write", "admin"],
    node_license: { copyright_holders: [], year: "" },
  },
  links: { html: "https://osf.io/awt3q/" },
  embeds: {
    license: { data: { id: "563c1cf88c5e4a3877f9e96a", attributes: { name: "CC-By Attribution 4.0 International" } } },
  },
};

const UNLICENSED = {
  id: "7t8nm",
  attributes: { title: "Pilot", public: false, current_user_permissions: ["read"], node_license: null },
  relationships: { parent: { data: { id: "abcde" } } },
};

const OPTIONS: LicenceOption[] = [
  { id: "563c1cf88c5e4a3877f9e972", name: "MIT License", url: null, requiredFields: ["year", "copyrightHolders"] },
  { id: "563c1cf88c5e4a3877f9e965", name: "No license", url: null, requiredFields: ["year", "copyrightHolders"] },
  { id: "563c1cf88c5e4a3877f9e96e", name: "Other", url: null, requiredFields: [] },
  { id: "563c1cf88c5e4a3877f9e96c", name: "CC0 1.0 Universal", url: null, requiredFields: [] },
  { id: DEFAULT_LICENCE_ID, name: "CC-By Attribution 4.0 International", url: null, requiredFields: [] },
];

describe("classifyLicence", () => {
  it("separates licensed, none, other and unknown", () => {
    expect(classifyLicence("CC0 1.0 Universal")).toBe("licensed");
    expect(classifyLicence(null)).toBe("none");
    expect(classifyLicence("  ")).toBe("none");
    expect(classifyLicence("No license")).toBe("none");
    expect(classifyLicence("Other")).toBe("other");
    // A failed lookup must never read as "no licence".
    expect(classifyLicence(undefined)).toBe("unknown");
  });
});

describe("toLicenceRow", () => {
  it("reads a licensed node", () => {
    const r = toLicenceRow(LICENSED);
    expect(r).toMatchObject({ guid: "awt3q", status: "licensed", licenceId: DEFAULT_LICENCE_ID, canEdit: true, year: null, parentId: null });
  });

  it("reads a node with no licence embed as none, and read-only permission as not editable", () => {
    const r = toLicenceRow(UNLICENSED);
    expect(r).toMatchObject({ status: "none", licenceName: null, canEdit: false, parentId: "abcde", osfUrl: "https://osf.io/7t8nm/" });
  });

  it("treats a licence relationship with no readable embed as unknown, not none", () => {
    const r = toLicenceRow({ ...UNLICENSED, relationships: { license: { data: { id: DEFAULT_LICENCE_ID } } } });
    expect(r.status).toBe("unknown");
    expect(r.licenceId).toBe(DEFAULT_LICENCE_ID);
  });

  it("treats a failed embed as unknown, not none", () => {
    const r = toLicenceRow({ ...UNLICENSED, embeds: { license: { errors: [{ detail: "boom" }] } } });
    expect(r.status).toBe("unknown");
  });

  it("write permission alone is enough to edit (OSF set_license checks WRITE)", () => {
    expect(toLicenceRow({ ...UNLICENSED, attributes: { ...UNLICENSED.attributes, current_user_permissions: ["read", "write"] } }).canEdit).toBe(true);
  });
});

describe("pickableLicences", () => {
  it("drops No license and Other, puts CC BY 4.0 first", () => {
    const names = pickableLicences(OPTIONS).map((o) => o.name);
    expect(names[0]).toBe("CC-By Attribution 4.0 International");
    expect(names).not.toContain("No license");
    expect(names).not.toContain("Other");
    expect(names).toHaveLength(3);
  });
});

describe("validateApply", () => {
  const ccby = OPTIONS[4]!;
  const mit = OPTIONS[0]!;
  it("CC BY needs nothing else", () => {
    expect(validateApply({ licenceId: ccby.id, copyrightHolders: [], year: "" }, ccby)).toEqual([]);
  });
  it("MIT needs a holder and a year", () => {
    const p = validateApply({ licenceId: mit.id, copyrightHolders: [" "], year: "" }, mit);
    expect(p.join(" ")).toMatch(/copyright holder/);
    expect(p.join(" ")).toMatch(/four-digit year/);
  });
  it("rejects an unknown licence and a non-licence", () => {
    expect(validateApply({ licenceId: "x", copyrightHolders: [], year: "" }, undefined)).toHaveLength(1);
    expect(validateApply({ licenceId: OPTIONS[2]!.id, copyrightHolders: [], year: "" }, OPTIONS[2])[0]).toMatch(/not a reuse licence/);
  });
  it("rejects a malformed optional year", () => {
    expect(validateApply({ licenceId: ccby.id, copyrightHolders: [], year: "24" }, ccby)).toHaveLength(1);
  });
});

describe("buildLicencePatch", () => {
  it("matches OSF NodeSerializer: node_license attributes + license relationship", () => {
    expect(buildLicencePatch("awt3q", { licenceId: DEFAULT_LICENCE_ID, copyrightHolders: [" Jane Doe ", ""], year: " 2024 " })).toEqual({
      data: {
        type: "nodes",
        id: "awt3q",
        attributes: { node_license: { year: "2024", copyright_holders: ["Jane Doe"] } },
        relationships: { license: { data: { type: "licenses", id: DEFAULT_LICENCE_ID } } },
      },
    });
  });
});

describe("confirmApplied", () => {
  const input = { licenceId: DEFAULT_LICENCE_ID, copyrightHolders: [], year: "" };
  it("confirms only when the read-back shows the requested licence", () => {
    expect(confirmApplied(toLicenceRow(LICENSED), input)).toMatchObject({ guid: "awt3q", ok: true, row: { licenceId: DEFAULT_LICENCE_ID } });
    const bad = confirmApplied(toLicenceRow(UNLICENSED), input);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.reason).toMatch(/still shows no licence/);
  });
});

describe("confirmApplied — same licence, new holder", () => {
  it("refuses to confirm when the read-back holder or year differs from the input", () => {
    const r = confirmApplied(toLicenceRow(LICENSED), { licenceId: DEFAULT_LICENCE_ID, copyrightHolders: ["Jane Doe"], year: "2024" });
    expect(r.ok).toBe(false);
  });
});

describe("summariseRows", () => {
  it("counts every status, including an empty list", () => {
    expect(summariseRows([])).toEqual({ licensed: 0, none: 0, other: 0, unknown: 0 });
    expect(summariseRows([toLicenceRow(LICENSED), toLicenceRow(UNLICENSED)])).toEqual({ licensed: 1, none: 1, other: 0, unknown: 0 });
  });
});

describe("isTickable", () => {
  it("allows only editable none/other rows; never unknown or licensed", async () => {
    const { isTickable } = await import("@/lib/licence/check");
    expect(isTickable({ canEdit: true, status: "none" })).toBe(true);
    expect(isTickable({ canEdit: true, status: "other" })).toBe(true);
    expect(isTickable({ canEdit: true, status: "unknown" })).toBe(false);
    expect(isTickable({ canEdit: true, status: "licensed" })).toBe(false);
    expect(isTickable({ canEdit: false, status: "none" })).toBe(false);
  });
});
