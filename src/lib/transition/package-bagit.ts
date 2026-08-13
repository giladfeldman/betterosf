/**
 * BagIt packaging for an exported project.
 *
 * BagIt (RFC 8493) is a boring, 20-year-old, widely-implemented spec for "a directory of
 * files plus a checksum manifest". It is worth having for exactly one line:
 *
 *     Payload-Oxum: <total octets>.<number of files>
 *
 * That single field is an independently checkable completeness assertion. Anyone — us,
 * the researcher, a repository, `bagit.py` — can count the payload and compare, years
 * from now, without trusting anything BetterOSF said. RO-Crate carries the semantics
 * BagIt cannot; BagIt carries the arithmetic RO-Crate does not. They are complementary,
 * and both are three text files' worth of effort.
 *
 * Pure string generation, no I/O — so every byte of the manifest is testable.
 */

import { TERMS_VERSION } from "@/lib/terms";

export type BagFile = {
  /** Path within the bag's `data/` directory, forward slashes, no leading slash. */
  path: string;
  size: number;
  sha256: string;
  md5?: string | null;
};

export type BagInfo = {
  projectTitle: string;
  projectGuid: string;
  osfUrl: string;
  /** ISO timestamp. Passed in, never read from a clock here. */
  createdAt: string;
  appVersion: string;
  /** Set when the export was not complete — recorded IN the bag, not only in the UI. */
  incompleteReason?: string | null;
};

/** `Payload-Oxum` — total octets and stream count, the completeness primitive. */
export function payloadOxum(files: BagFile[]): string {
  const octets = files.reduce((n, f) => n + f.size, 0);
  return `${octets}.${files.length}`;
}

/**
 * Escape a path for a BagIt manifest.
 *
 * RFC 8493 requires CR and LF in filenames to be percent-encoded, because the manifest is
 * line-oriented and a newline in a name would forge an extra entry.
 */
export function encodeManifestPath(path: string): string {
  return path.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}

/** `<checksum>  data/<path>` per line, sorted for a byte-stable manifest. */
export function renderManifest(files: BagFile[], algorithm: "sha256" | "md5"): string {
  const lines = files
    .filter((f) => (algorithm === "sha256" ? f.sha256 : f.md5))
    .map((f) => {
      const sum = algorithm === "sha256" ? f.sha256 : f.md5!;
      return `${sum}  data/${encodeManifestPath(f.path)}`;
    })
    .sort();
  return lines.length > 0 ? `${lines.join("\n")}\n` : "";
}

export function renderBagitTxt(): string {
  return "BagIt-Version: 1.0\nTag-File-Character-Encoding: UTF-8\n";
}

export function renderBagInfo(info: BagInfo, files: BagFile[]): string {
  const lines = [
    `Bag-Software-Agent: BetterOSF ${info.appVersion} (https://betterosf.vercel.app)`,
    `Bagging-Date: ${info.createdAt.slice(0, 10)}`,
    `External-Identifier: ${info.osfUrl}`,
    `External-Description: Export of OSF project "${sanitiseHeaderValue(info.projectTitle)}" (${info.projectGuid})`,
    `Payload-Oxum: ${payloadOxum(files)}`,
    `BetterOSF-Terms-Version: ${TERMS_VERSION}`,
  ];
  if (info.incompleteReason) {
    // Recorded in the bag itself, not only on a screen the researcher will close. An
    // incomplete export that travels without saying so is the artefact most likely to be
    // mistaken for a complete one in three years' time.
    lines.push(`BetterOSF-Export-Status: INCOMPLETE — ${sanitiseHeaderValue(info.incompleteReason)}`);
  } else {
    lines.push("BetterOSF-Export-Status: complete");
  }
  return `${lines.join("\n")}\n`;
}

/** Tag fields are one per line; fold or strip anything that would break that. */
function sanitiseHeaderValue(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

/**
 * The disclaimer that travels WITH the data.
 *
 * It is in the bag rather than only on a screen because the archive will outlive the
 * session that made it. Someone opening this in 2031 needs to know what the checksums
 * do and do not prove, and that BetterOSF never deleted anything from OSF to make it.
 */
export function renderDisclaimer(info: BagInfo): string {
  return `ABOUT THIS EXPORT
=================

Created by BetterOSF ${info.appVersion} on ${info.createdAt}.
Source: ${info.osfUrl}

WHAT THE CHECKSUMS PROVE
------------------------
manifest-sha256.txt lists a SHA-256 for every file in data/. Each was computed over the
bytes actually received, and — where OSF supplied a checksum of its own — compared
against it. Files that OSF could not vouch for (typically files held in third-party
storage such as Dropbox, Google Drive or S3, which OSF proxies without checksumming) are
recorded in the export report as "unverifiable". They are included, but their fidelity to
the original was never confirmed.

Payload-Oxum in bag-info.txt gives the total byte count and file count of data/. You can
check this export is intact without trusting BetterOSF, using any BagIt tool.

WHAT THIS IS NOT
----------------
This is a copy, made once, by a free tool. It is NOT a warranty that the export is
complete, faithful, or readable, and it is not an archival or preservation service.
Verify it yourself before relying on it.

BetterOSF did NOT delete or alter anything on OSF to create this export, and never does.
If you intend to remove the original from OSF, confirm independently that this copy is
complete first.

BetterOSF is an independent third-party client. It is not affiliated with, endorsed by,
or operated by the Center for Open Science or OSF.

Full terms (version ${TERMS_VERSION}): https://betterosf.vercel.app/terms
`;
}

export type BagTagFiles = {
  "bagit.txt": string;
  "bag-info.txt": string;
  "manifest-sha256.txt": string;
  "manifest-md5.txt": string;
  "DISCLAIMER.txt": string;
};

/** Every tag file for a bag, ready to be written alongside `data/`. */
export function buildBagTagFiles(info: BagInfo, files: BagFile[]): BagTagFiles {
  return {
    "bagit.txt": renderBagitTxt(),
    "bag-info.txt": renderBagInfo(info, files),
    "manifest-sha256.txt": renderManifest(files, "sha256"),
    "manifest-md5.txt": renderManifest(files, "md5"),
    "DISCLAIMER.txt": renderDisclaimer(info),
  };
}
