/**
 * The archive the Zenodo downloader hands back really is a FOLDER TREE.
 *
 * The whole page rests on one claim: a Zenodo key like
 * `osfstorage/PCIRR Stage 1/data/raw.csv` becomes four levels of real directories when the
 * reader unzips it, rather than one file with slashes in its name. That claim is about the
 * bytes in the archive, so this reads the names back out of the ZIP itself rather than
 * trusting the array that went in.
 *
 * Verified against a completely independent unzipper on 2026-08-14 — Windows'
 * `Expand-Archive` — which produced the nested directories on disk, four deep, with spaces
 * in the folder names. That is not automatable across platforms here, so what this test
 * pins is the property that decides it: the entry names stored in the archive keep their
 * forward slashes and carry no traversal.
 *
 * ## Live fixtures for testing the page by hand
 *
 * Two published SANDBOX records exist for this, so nobody has to build them again:
 *
 *   - `https://sandbox.zenodo.org/records/587114` — a realistic BetterOSF-shaped deposit:
 *     four levels deep, spaces in folder names, a `components/` prefix, a file at the root,
 *     and **two different `raw.csv` files in different folders** (a flat unzip collides
 *     them). Verified end to end: 6/6 md5 matched and Expand-Archive produced the tree.
 *   - `https://sandbox.zenodo.org/records/587118` — every key on it is one Zenodo publishes
 *     happily and Windows cannot take (`..\windows-escape.txt`, `C:\Windows\evil.dll`,
 *     `CON`, `dir/NUL.txt`, `a<b>c"d|e?f*g.txt`, `trailing. `). Use it to watch the rename
 *     reporting work.
 *
 * On production, any GitHub-archived release has a slashed key (`owner/repo-vX.Y.Z.zip`) —
 * e.g. records 21934832, 21936356, 21934451 — but all are depth 1, which is why the sandbox
 * fixtures exist. A scan of 176 public records found no deep-tree example at all.
 */
import { describe, it, expect } from "vitest";
import { downloadZip } from "client-zip";
import { zipEntryPath } from "@/lib/zenodo-download/record";

/** Entry names as they are actually recorded in the archive's local file headers. */
function storedNames(zip: Uint8Array): string[] {
  const view = Buffer.from(zip);
  const names: string[] = [];
  for (let i = 0; i < view.length - 30; i++) {
    // Local file header: PK\x03\x04
    if (view[i] === 0x50 && view[i + 1] === 0x4b && view[i + 2] === 0x03 && view[i + 3] === 0x04) {
      const nameLen = view.readUInt16LE(i + 26);
      const extraLen = view.readUInt16LE(i + 28);
      names.push(view.subarray(i + 30, i + 30 + nameLen).toString("utf8"));
      i += 30 + nameLen + extraLen - 1;
    }
  }
  return names;
}

async function buildFrom(keys: string[]): Promise<string[]> {
  const response = downloadZip(
    keys.map((key) => ({ name: zipEntryPath(key), input: `contents of ${key}\n` })),
  );
  return storedNames(new Uint8Array(await response.arrayBuffer()));
}

describe("the downloaded archive is a directory tree", () => {
  it("stores each key as a nested path, slashes intact", async () => {
    const names = await buildFrom([
      "osfstorage/PCIRR Stage 1/PCIRR submission/cover-letter.docx",
      "osfstorage/PCIRR Stage 1/data/raw.csv",
      "osfstorage/README.md",
      "components/ytpuq-Analysis/osfstorage/model.R",
      "top-level.txt",
    ]);

    expect(names).toEqual([
      "osfstorage/PCIRR Stage 1/PCIRR submission/cover-letter.docx",
      "osfstorage/PCIRR Stage 1/data/raw.csv",
      "osfstorage/README.md",
      "components/ytpuq-Analysis/osfstorage/model.R",
      "top-level.txt",
    ]);
    // Four levels deep, and the spaces in "PCIRR Stage 1" survive as part of a folder name
    // rather than being sanitised into the filename.
    expect(names[0]!.split("/")).toHaveLength(4);
  });

  it("stores a GitHub-release deposit's owner/repo key as a folder", async () => {
    // The commonest real shape on production Zenodo: every GitHub-archived release is one
    // file whose key is `owner/repo-vX.Y.Z.zip`. Depth 1, and a good live smoke test.
    const names = await buildFrom(["OpenGreekAndLatin/First1KGreek-1.1.31813801597.zip"]);
    expect(names).toEqual(["OpenGreekAndLatin/First1KGreek-1.1.31813801597.zip"]);
  });

  it("cannot be made to write outside the archive", async () => {
    // Zenodo accepts these keys and stores them verbatim (measured 2026-08-14), so they can
    // really arrive. No stored name may start with a separator, carry a `..` segment, or
    // name a drive.
    const names = await buildFrom([
      "../escaped.txt",
      "a/../../escaped2.txt",
      "/absolute.txt",
      "..\\windows.txt",
      "C:\\Windows\\System32\\evil.dll",
    ]);

    for (const name of names) {
      expect(name.startsWith("/"), `${name} is absolute`).toBe(false);
      expect(name.split("/").includes(".."), `${name} contains a traversal segment`).toBe(false);
      expect(name).not.toContain("\\");
      expect(name).not.toMatch(/^[A-Za-z]:/);
    }
    // And nothing was silently dropped — every file still has an entry.
    expect(names).toHaveLength(5);
  });

  it("keeps every entry name unique, so one file cannot overwrite another", async () => {
    const names = await buildFrom([
      "osfstorage/a.csv",
      "osfstorage/b.csv",
      "osfstorage/sub/a.csv",
    ]);
    expect(new Set(names).size).toBe(names.length);
  });
});
