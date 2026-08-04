import { describe, it, expect } from "vitest";
import {
  resolveRenameUrl,
  cleanRenameName,
  mapUploadStatus,
  OsfWriteError,
  MAX_RENAME_NAME_LENGTH,
  type RenameTarget,
} from "@/lib/osf/waterbutler-url";

const GUID = "abcde";
const NODE_LISTING = `https://api.osf.io/v2/nodes/${GUID}/files/osfstorage/`;
const REGISTRATION_LISTING = `https://api.osf.io/v2/registrations/${GUID}/files/osfstorage/`;
const WB = `https://files.osf.io/v1/resources/${GUID}/providers/osfstorage`;

function target(overrides: Partial<RenameTarget> = {}): RenameTarget {
  return {
    guid: GUID,
    provider: "osfstorage",
    kind: "file",
    path: "/data.csv",
    name: "data.csv",
    moveUrl: `${WB}/5f1a2b3c4d`,
    listingUrl: NODE_LISTING,
    ...overrides,
  };
}

describe("resolveRenameUrl — registration pin (the most important gate)", () => {
  it("refuses a registration listing URL", () => {
    // Registration and node Waterbutler URLs are ORIGIN-IDENTICAL, so the host/prefix
    // check cannot distinguish them. This pin is the only thing that can.
    expect(() => resolveRenameUrl(target({ listingUrl: REGISTRATION_LISTING }))).toThrow(OsfWriteError);
  });

  it("names registrations in the refusal so the user understands why", () => {
    try {
      resolveRenameUrl(target({ listingUrl: REGISTRATION_LISTING }));
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as OsfWriteError).status).toBe(400);
      expect((e as OsfWriteError).message).toMatch(/registration/i);
    }
  });

  it("refuses a listing URL on a non-OSF host", () => {
    expect(() => resolveRenameUrl(target({ listingUrl: "https://evil.example.com/v2/nodes/abcde/" }))).toThrow(OsfWriteError);
  });

  it("accepts a genuine node listing URL", () => {
    expect(resolveRenameUrl(target())).toContain("files.osf.io");
  });
});

describe("resolveRenameUrl — root refusal", () => {
  it("refuses the provider root with no trailing slash", () => {
    expect(() => resolveRenameUrl(target({ kind: "folder", moveUrl: WB }))).toThrow(OsfWriteError);
  });

  it("refuses the provider root with a trailing slash", () => {
    expect(() => resolveRenameUrl(target({ kind: "folder", moveUrl: `${WB}/` }))).toThrow(OsfWriteError);
  });

  it("strips a query string and STILL refuses the root", () => {
    expect(() => resolveRenameUrl(target({ kind: "folder", moveUrl: `${WB}/?confirm_delete=1` }))).toThrow(OsfWriteError);
  });

  it("strips an arbitrary query string and hash from a non-root item", () => {
    const out = resolveRenameUrl(target({ moveUrl: `${WB}/5f1a2b3c4d?foo=bar&baz=1#frag` }));
    expect(out).toBe(`${WB}/5f1a2b3c4d`);
  });
});

describe("resolveRenameUrl — trailing slash is derived from kind, never trusted", () => {
  it("forces a trailing slash for a folder", () => {
    const out = resolveRenameUrl(target({ kind: "folder", moveUrl: `${WB}/5f1a2b3c4d`, name: "subfolder" }));
    expect(out.endsWith("/")).toBe(true);
  });

  it("strips a trailing slash for a file", () => {
    const out = resolveRenameUrl(target({ kind: "file", moveUrl: `${WB}/5f1a2b3c4d/` }));
    expect(out.endsWith("/")).toBe(false);
  });
});

describe("resolveRenameUrl — inherited URL pinning", () => {
  it("rejects a non-OSF host", () => {
    expect(() => resolveRenameUrl(target({ moveUrl: `https://evil.example.com/v1/resources/${GUID}/providers/osfstorage/x` }))).toThrow(OsfWriteError);
  });

  it("rejects embedded credentials", () => {
    expect(() => resolveRenameUrl(target({ moveUrl: `https://u:p@files.osf.io/v1/resources/${GUID}/providers/osfstorage/x` }))).toThrow(OsfWriteError);
  });

  it("rejects an explicit port", () => {
    expect(() => resolveRenameUrl(target({ moveUrl: `https://files.osf.io:8443/v1/resources/${GUID}/providers/osfstorage/x` }))).toThrow(OsfWriteError);
  });

  it("rejects non-https", () => {
    expect(() => resolveRenameUrl(target({ moveUrl: `http://files.osf.io/v1/resources/${GUID}/providers/osfstorage/x` }))).toThrow(OsfWriteError);
  });

  it("rejects a move URL belonging to a different guid", () => {
    expect(() => resolveRenameUrl(target({ moveUrl: `https://files.osf.io/v1/resources/other1/providers/osfstorage/x` }))).toThrow(OsfWriteError);
  });

  it("accepts a regional files host", () => {
    const out = resolveRenameUrl(target({ moveUrl: `https://files.de-1.osf.io/v1/resources/${GUID}/providers/osfstorage/x` }));
    expect(out).toContain("files.de-1.osf.io");
  });

  it("rejects an invalid guid", () => {
    expect(() => resolveRenameUrl(target({ guid: "!!" }))).toThrow(OsfWriteError);
  });

  it("rejects a non-osfstorage provider", () => {
    expect(() => resolveRenameUrl(target({ provider: "dropbox" }))).toThrow(OsfWriteError);
  });
});

describe("cleanRenameName", () => {
  it("accepts an ordinary name and trims whitespace", () => {
    expect(cleanRenameName("  results.csv  ")).toBe("results.csv");
  });

  it("accepts unicode names", () => {
    expect(cleanRenameName("données-α.csv")).toBe("données-α.csv");
  });

  it("does NOT percent-decode a typed name (unlike cleanName)", () => {
    // "%20" typed by the user must remain a literal "%20", not become a space.
    expect(cleanRenameName("file%20name.txt")).toBe("file%20name.txt");
  });

  it("rejects an empty name", () => {
    expect(() => cleanRenameName("")).toThrow(OsfWriteError);
  });

  it("rejects a whitespace-only name", () => {
    expect(() => cleanRenameName("   ")).toThrow(OsfWriteError);
  });

  it("rejects '.'", () => {
    expect(() => cleanRenameName(".")).toThrow(OsfWriteError);
  });

  it("rejects '..'", () => {
    expect(() => cleanRenameName("..")).toThrow(OsfWriteError);
  });

  it("rejects a forward slash", () => {
    expect(() => cleanRenameName("a/b")).toThrow(OsfWriteError);
  });

  it("rejects a backslash", () => {
    expect(() => cleanRenameName("a\\b")).toThrow(OsfWriteError);
  });

  it("rejects names longer than the cap", () => {
    expect(() => cleanRenameName("x".repeat(MAX_RENAME_NAME_LENGTH + 1))).toThrow(OsfWriteError);
  });

  it("accepts a name exactly at the cap", () => {
    expect(cleanRenameName("x".repeat(MAX_RENAME_NAME_LENGTH))).toHaveLength(MAX_RENAME_NAME_LENGTH);
  });

  it("throws a 400 'invalid' error, never a 500", () => {
    try {
      cleanRenameName("a/b");
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as OsfWriteError).status).toBe(400);
      expect((e as OsfWriteError).code).toBe("invalid");
    }
  });
});

describe("mapUploadStatus rename verb", () => {
  it("says 'rename' when asked", () => {
    expect(mapUploadStatus(500, "", "rename").message).toMatch(/rename failed/i);
  });

  it("maps 409 to a conflict for rename collisions", () => {
    const err = mapUploadStatus(409, "", "rename");
    expect(err.code).toBe("conflict");
    expect(err.message).toMatch(/already exists/i);
  });
});
