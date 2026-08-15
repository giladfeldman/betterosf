/**
 * Reading a Zenodo record reference, and rebuilding the folder tree its keys encode.
 *
 * The parsing matters more than it looks: a wrong record id silently downloads somebody
 * else's data under the name of the one the user asked for. Every ambiguous input returns
 * null rather than a guess.
 */
import { describe, it, expect } from "vitest";
import {
  archiveName,
  buildTree,
  encodeKey,
  parseMd5,
  parseRecordRef,
  zipEntryPath,
  wasRewritten,
} from "@/lib/zenodo-download/record";

describe("parseRecordRef", () => {
  it("takes a production record URL", () => {
    const r = parseRecordRef("https://zenodo.org/records/10001")!;
    expect(r.recordId).toBe("10001");
    expect(r.host.label).toBe("zenodo.org");
  });

  it("takes the older /record/ URL form, and one with a trailing path", () => {
    expect(parseRecordRef("https://zenodo.org/record/10001")!.recordId).toBe("10001");
    expect(parseRecordRef("https://zenodo.org/records/10001/files/a.csv")!.recordId).toBe("10001");
  });

  it("keeps sandbox and production apart, by host and by DOI prefix", () => {
    // Downloading sandbox data believing it is the real record would be a quiet disaster:
    // sandbox deposits are wipeable test records.
    expect(parseRecordRef("https://sandbox.zenodo.org/records/587080")!.host.label).toBe(
      "sandbox.zenodo.org",
    );
    // 10.5072 is DataCite's TEST prefix, which is what sandbox mints.
    expect(parseRecordRef("10.5072/zenodo.587080")!.host.label).toBe("sandbox.zenodo.org");
    expect(parseRecordRef("10.5281/zenodo.10001")!.host.label).toBe("zenodo.org");
  });

  it("takes a DOI URL", () => {
    const r = parseRecordRef("https://doi.org/10.5281/zenodo.10001")!;
    expect(r.recordId).toBe("10001");
    expect(r.host.label).toBe("zenodo.org");
  });

  it("takes a bare record number", () => {
    expect(parseRecordRef("10001")).toEqual(
      expect.objectContaining({ recordId: "10001" }),
    );
  });

  it("refuses anything it cannot read, instead of guessing", () => {
    for (const bad of ["", "   ", "not a url", "https://example.com/records/10001", "https://zenodo.org/communities/x"]) {
      expect(parseRecordRef(bad)).toBeNull();
    }
  });
});

describe("buildTree", () => {
  const file = (key: string) => ({ key, size: 1, md5: null, contentUrl: "" });

  it("rebuilds the hierarchy the slashes describe", () => {
    const root = buildTree([
      file("osfstorage/data/raw.csv"),
      file("osfstorage/data/clean.csv"),
      file("osfstorage/README.md"),
      file("top-level.txt"),
    ]);

    expect(root.files.map((f) => f.key)).toEqual(["top-level.txt"]);
    const osfstorage = root.folders.get("osfstorage")!;
    expect(osfstorage.files.map((f) => f.key)).toEqual(["osfstorage/README.md"]);
    expect([...osfstorage.folders.get("data")!.files].map((f) => f.key)).toEqual([
      "osfstorage/data/raw.csv",
      "osfstorage/data/clean.csv",
    ]);
  });

  it("handles a deposit with no paths at all", () => {
    const root = buildTree([file("a.csv"), file("b.csv")]);
    expect(root.folders.size).toBe(0);
    expect(root.files).toHaveLength(2);
  });
});

describe("encodeKey", () => {
  it("encodes each segment but keeps the slashes that give the deposit its structure", () => {
    expect(encodeKey("osfstorage/PCIRR Stage 1/a b.docx")).toBe(
      "osfstorage/PCIRR%20Stage%201/a%20b.docx",
    );
  });
});

describe("parseMd5", () => {
  it("strips Zenodo's md5: prefix and rejects anything else", () => {
    expect(parseMd5("md5:764efa883dda1e11db47671c4a3bbd9e")).toBe("764efa883dda1e11db47671c4a3bbd9e");
    // Not a checksum we can compare — null, never a placeholder that would compare equal
    // to something.
    expect(parseMd5("sha256:abc")).toBeNull();
    expect(parseMd5(null)).toBeNull();
    expect(parseMd5("764efa883dda1e11db47671c4a3bbd9e")).toBeNull();
  });
});

/**
 * Zip Slip.
 *
 * This tool takes ANY public Zenodo record, and a record's file keys are whatever its
 * depositor uploaded. Measured against sandbox.zenodo.org on 2026-08-14: Zenodo **accepts
 * and stores traversal-shaped keys verbatim** — `../escaped.txt`, `a/../../escaped2.txt`
 * and `/absolute.txt` were all created with 201 and listed back unchanged.
 *
 * So the key is untrusted input that ends up as a filesystem path in whatever the reader
 * unzips with. Some unzippers refuse traversal; plenty do not, and we do not get to choose
 * theirs.
 */
describe("zipEntryPath — untrusted keys must not escape the archive", () => {
  it("keeps a legitimate folder structure exactly as it is", () => {
    expect(zipEntryPath("osfstorage/PCIRR Stage 1/data/raw.csv")).toBe(
      "osfstorage/PCIRR Stage 1/data/raw.csv",
    );
    expect(zipEntryPath("top-level.txt")).toBe("top-level.txt");
  });

  it("removes traversal segments rather than the whole path", () => {
    // Dropping the file would lose data; keeping `..` would let it escape. Neutralise the
    // segment and keep everything else.
    expect(zipEntryPath("../escaped.txt")).toBe("escaped.txt");
    expect(zipEntryPath("a/../../escaped2.txt")).toBe("a/escaped2.txt");
    expect(zipEntryPath("a/./b/./c.txt")).toBe("a/b/c.txt");
  });

  it("makes an absolute path relative", () => {
    expect(zipEntryPath("/absolute.txt")).toBe("absolute.txt");
    expect(zipEntryPath("//srv/share/x.txt")).toBe("srv/share/x.txt");
  });

  it("neutralises Windows separators and drive letters", () => {
    // A backslash is a legal filename character on POSIX and a SEPARATOR on Windows, so a
    // key containing one means different things to different readers. Neither reading may
    // escape.
    expect(zipEntryPath("..\\windows.txt")).not.toContain("..");
    expect(zipEntryPath("C:\\Windows\\System32\\evil.dll")).not.toMatch(/^[A-Za-z]:/);
    expect(zipEntryPath("C:\\Windows\\System32\\evil.dll")).not.toContain("\\");
  });

  it("strips characters and names that break extraction on Windows", () => {
    expect(zipEntryPath('a<b>c:d"e|f?g*h.txt')).not.toMatch(/[<>:"|?*]/);
    // Reserved device names are unusable as files on Windows whatever the extension.
    expect(zipEntryPath("CON")).not.toBe("CON");
    expect(zipEntryPath("dir/NUL.txt")).not.toMatch(/\/NUL\./);
    // A trailing dot or space silently disappears on Windows, which would rename the file.
    expect(zipEntryPath("trailing. ")).not.toMatch(/[. ]$/);
  });

  it("never returns an empty path", () => {
    for (const key of ["", "   ", "..", "../..", "/", "///"]) {
      expect(zipEntryPath(key).length).toBeGreaterThan(0);
    }
  });

  it("reports when it changed a key, so a rename is never silent", () => {
    expect(wasRewritten("osfstorage/data/raw.csv")).toBe(false);
    expect(wasRewritten("../escaped.txt")).toBe(true);
  });
});

describe("archiveName", () => {
  it("keeps the record id and strips characters that break on Windows", () => {
    const name = archiveName({
      recordId: "10001",
      title: 'A: study/of "things"?',
      doi: null,
      publicationDate: null,
      creators: [],
      htmlUrl: "",
      files: [],
      filesRestricted: false,
    });
    expect(name).toMatch(/^zenodo-10001-/);
    expect(name).not.toMatch(/[\\/:*?"<>|]/);
    expect(name.endsWith(".zip")).toBe(true);
  });
});
