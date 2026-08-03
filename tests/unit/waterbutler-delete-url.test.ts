import { describe, it, expect } from "vitest";
import { resolveDeleteUrl, mapUploadStatus, OsfWriteError, type DeleteTarget } from "@/lib/osf/waterbutler-url";

const GUID = "abcde";
const NODE_LISTING = `https://api.osf.io/v2/nodes/${GUID}/files/osfstorage/`;
const REGISTRATION_LISTING = `https://api.osf.io/v2/registrations/${GUID}/files/osfstorage/`;
const WB = `https://files.osf.io/v1/resources/${GUID}/providers/osfstorage`;

function target(overrides: Partial<DeleteTarget> = {}): DeleteTarget {
  return {
    guid: GUID,
    provider: "osfstorage",
    kind: "file",
    path: "/data.csv",
    name: "data.csv",
    deleteUrl: `${WB}/5f1a2b3c4d`,
    listingUrl: NODE_LISTING,
    ...overrides,
  };
}

describe("resolveDeleteUrl — registration pin (the most important gate)", () => {
  it("refuses a registration listing URL", () => {
    // Registration and node Waterbutler URLs are ORIGIN-IDENTICAL, so the host/prefix
    // check cannot distinguish them. This pin is the only thing that can.
    expect(() => resolveDeleteUrl(target({ listingUrl: REGISTRATION_LISTING }))).toThrow(OsfWriteError);
  });

  it("names registrations in the refusal so the user understands why", () => {
    try {
      resolveDeleteUrl(target({ listingUrl: REGISTRATION_LISTING }));
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as OsfWriteError).status).toBe(400);
      expect((e as OsfWriteError).message).toMatch(/registration/i);
    }
  });

  it("refuses a listing URL on a non-OSF host", () => {
    expect(() => resolveDeleteUrl(target({ listingUrl: "https://evil.example.com/v2/nodes/abcde/" }))).toThrow(OsfWriteError);
  });

  it("accepts a genuine node listing URL", () => {
    expect(resolveDeleteUrl(target())).toContain("files.osf.io");
  });
});

describe("resolveDeleteUrl — root refusal (confirm_delete footgun)", () => {
  it("refuses the provider root with no trailing slash", () => {
    expect(() => resolveDeleteUrl(target({ kind: "folder", deleteUrl: WB }))).toThrow(OsfWriteError);
  });

  it("refuses the provider root with a trailing slash", () => {
    expect(() => resolveDeleteUrl(target({ kind: "folder", deleteUrl: `${WB}/` }))).toThrow(OsfWriteError);
  });

  it("strips ?confirm_delete=1 and STILL refuses the root", () => {
    // Waterbutler's confirm_delete=1 on a root does not delete the root — it recursively
    // deletes every file in the provider. The query must never survive client input.
    expect(() => resolveDeleteUrl(target({ kind: "folder", deleteUrl: `${WB}/?confirm_delete=1` }))).toThrow(OsfWriteError);
  });

  it("strips confirm_delete from a NON-root delete too", () => {
    const out = resolveDeleteUrl(target({ deleteUrl: `${WB}/5f1a2b3c4d?confirm_delete=1` }));
    expect(out).not.toContain("confirm_delete");
    expect(out).not.toContain("?");
  });

  it("strips an arbitrary query string and hash", () => {
    const out = resolveDeleteUrl(target({ deleteUrl: `${WB}/5f1a2b3c4d?foo=bar&baz=1#frag` }));
    expect(out).toBe(`${WB}/5f1a2b3c4d`);
  });
});

describe("resolveDeleteUrl — trailing slash is derived from kind, never trusted", () => {
  it("forces a trailing slash for a folder", () => {
    const out = resolveDeleteUrl(target({ kind: "folder", deleteUrl: `${WB}/5f1a2b3c4d`, name: "subfolder" }));
    expect(out.endsWith("/")).toBe(true);
  });

  it("collapses repeated trailing slashes on a folder to exactly one", () => {
    const out = resolveDeleteUrl(target({ kind: "folder", deleteUrl: `${WB}/5f1a2b3c4d///`, name: "subfolder" }));
    expect(out.endsWith("/")).toBe(true);
    expect(out.endsWith("//")).toBe(false);
  });

  it("strips a trailing slash for a file", () => {
    const out = resolveDeleteUrl(target({ kind: "file", deleteUrl: `${WB}/5f1a2b3c4d/` }));
    expect(out.endsWith("/")).toBe(false);
  });
});

describe("resolveDeleteUrl — inherited URL pinning", () => {
  it("rejects a non-OSF delete host", () => {
    expect(() => resolveDeleteUrl(target({ deleteUrl: `https://evil.example.com/v1/resources/${GUID}/providers/osfstorage/x` }))).toThrow(OsfWriteError);
  });

  it("rejects embedded credentials", () => {
    expect(() => resolveDeleteUrl(target({ deleteUrl: `https://u:p@files.osf.io/v1/resources/${GUID}/providers/osfstorage/x` }))).toThrow(OsfWriteError);
  });

  it("rejects an explicit port", () => {
    expect(() => resolveDeleteUrl(target({ deleteUrl: `https://files.osf.io:8443/v1/resources/${GUID}/providers/osfstorage/x` }))).toThrow(OsfWriteError);
  });

  it("rejects non-https", () => {
    expect(() => resolveDeleteUrl(target({ deleteUrl: `http://files.osf.io/v1/resources/${GUID}/providers/osfstorage/x` }))).toThrow(OsfWriteError);
  });

  it("rejects a delete URL belonging to a different guid", () => {
    expect(() => resolveDeleteUrl(target({ deleteUrl: `https://files.osf.io/v1/resources/other1/providers/osfstorage/x` }))).toThrow(OsfWriteError);
  });

  it("accepts a regional files host", () => {
    const out = resolveDeleteUrl(target({ deleteUrl: `https://files.de-1.osf.io/v1/resources/${GUID}/providers/osfstorage/x` }));
    expect(out).toContain("files.de-1.osf.io");
  });

  it("rejects an invalid guid", () => {
    expect(() => resolveDeleteUrl(target({ guid: "!!" }))).toThrow(OsfWriteError);
  });

  it("rejects a non-osfstorage provider", () => {
    expect(() => resolveDeleteUrl(target({ provider: "dropbox" }))).toThrow(OsfWriteError);
  });
});

describe("mapUploadStatus verb", () => {
  it("defaults to 'upload' so existing callers are unchanged", () => {
    expect(mapUploadStatus(500, "").message).toMatch(/upload failed/i);
  });

  it("says 'delete' when asked", () => {
    expect(mapUploadStatus(500, "", "delete").message).toMatch(/delete failed/i);
  });

  it("maps shared statuses identically regardless of verb", () => {
    expect(mapUploadStatus(401, "", "delete").code).toBe("unauthorized");
    expect(mapUploadStatus(403, "", "delete").code).toBe("forbidden");
  });
});
