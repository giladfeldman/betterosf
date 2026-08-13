/**
 * The export report — the artefact a researcher actually keeps.
 *
 * Three jobs:
 *   1. State plainly whether the export was complete, and if not, exactly what is missing.
 *   2. Record the metadata fidelity table, so nobody later assumes the crosswalk was
 *      lossless.
 *   3. Emit the OSF→destination crosswalk CSV, which is what a researcher needs to repair
 *      the links in papers, READMEs, preregistrations and lab wikis. That file is the
 *      difference between "I moved my data" and "I moved my data and my citations still
 *      resolve".
 *
 * Pure string generation. The verdict is passed in already computed by `reconcile()` —
 * this module never decides success, it only renders the decision.
 */

import type { ReconciliationVerdict } from "./verify";
import type { FidelityRow } from "./crosswalk";
import { TERMS_VERSION } from "@/lib/terms";

export type ReportInput = {
  projectTitle: string;
  projectGuid: string;
  osfUrl: string;
  osfDoi: string | null;
  destination: { name: string; recordUrl: string | null; doi: string | null } | null;
  verdict: ReconciliationVerdict;
  fidelity: FidelityRow[];
  files: { path: string; size: number; sha256: string | null; state: string; destinationKey?: string | null }[];
  createdAt: string;
  appVersion: string;
};

/** RFC 4180 quoting: wrap in quotes and double any internal quote. */
export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * The crosswalk CSV: every OSF path mapped to where it now lives.
 *
 * Includes the verification state per row, so a reader can tell at a glance which files
 * were checksum-confirmed and which were merely copied.
 */
export function renderCrosswalkCsv(input: ReportInput): string {
  const header = [
    "osf_project_guid",
    "osf_project_url",
    "osf_doi",
    "osf_path",
    "size_bytes",
    "sha256",
    "verification",
    "destination",
    "destination_key",
    "destination_record_url",
    "destination_doi",
  ];

  const rows = input.files.map((f) =>
    [
      input.projectGuid,
      input.osfUrl,
      input.osfDoi ?? "",
      f.path,
      f.size,
      f.sha256 ?? "",
      f.state,
      input.destination?.name ?? "local export",
      f.destinationKey ?? "",
      input.destination?.recordUrl ?? "",
      input.destination?.doi ?? "",
    ]
      .map(csvCell)
      .join(","),
  );

  return `${[header.join(","), ...rows].join("\n")}\n`;
}

/** Human-readable report, deposited alongside the data and offered as a download. */
export function renderReportMarkdown(input: ReportInput): string {
  const v = input.verdict;

  const statusLine =
    v.status === "complete"
      ? "**COMPLETE** — every expected file was transferred."
      : v.status === "empty"
        ? "**NOTHING WAS TRANSFERRED** — the plan contained no files."
        : "**INCOMPLETE — do not treat this as a full copy.**";

  const lines: string[] = [
    `# Export report — ${input.projectTitle}`,
    "",
    `- Source: ${input.osfUrl}${input.osfDoi ? ` (DOI ${input.osfDoi})` : ""}`,
    `- Destination: ${input.destination ? `${input.destination.name}${input.destination.recordUrl ? ` — ${input.destination.recordUrl}` : ""}` : "downloaded to your computer"}`,
    `- Created: ${input.createdAt} by BetterOSF ${input.appVersion}`,
    `- Terms version: ${TERMS_VERSION}`,
    "",
    "## Result",
    "",
    statusLine,
    "",
    v.summary,
    "",
    "| | Count |",
    "|---|---|",
    `| Expected | ${v.counts.expected} |`,
    `| Verified by checksum | ${v.counts.verified} |`,
    `| Transferred but unverifiable | ${v.counts.unverifiable} |`,
    `| Failed | ${v.counts.failed} |`,
    `| Missing | ${v.counts.missing} |`,
    `| Unexpected extra | ${v.counts.extra} |`,
    "",
  ];

  if (v.missing.length > 0) {
    lines.push("### Missing", "", ...v.missing.map((p) => `- \`${p}\``), "");
  }
  if (v.failed.length > 0) {
    lines.push(
      "### Failed",
      "",
      ...v.failed.map((f) => `- \`${f.path}\`\n  - ${f.problems.join("\n  - ")}`),
      "",
    );
  }
  if (v.extra.length > 0) {
    lines.push(
      "### Unexpected files at the destination",
      "",
      ...v.extra.map((p) => `- \`${p}\``),
      "",
    );
  }
  if (v.unverifiable.length > 0) {
    lines.push(
      "### Transferred but not verifiable",
      "",
      "OSF supplied no checksum for these files, so BetterOSF could not confirm that what",
      "arrived matches the original. This is normal for files held in third-party storage",
      "(Dropbox, Google Drive, S3, GitHub), which OSF proxies without checksumming.",
      "",
      ...v.unverifiable.map((p) => `- \`${p}\``),
      "",
    );
  }

  if (input.fidelity.length > 0) {
    lines.push(
      "## Metadata fidelity",
      "",
      "How each field survived the crossing between OSF and the destination.",
      "",
      "| Field | From | Status | Note |",
      "|---|---|---|---|",
      ...input.fidelity.map(
        (r) => `| ${r.field} | ${r.source} | ${r.status} | ${r.note.replace(/\|/g, "\\|")} |`,
      ),
      "",
    );
  }

  lines.push(
    "## What this report is not",
    "",
    "This records what BetterOSF observed during one run. It is **not** a warranty that the",
    "export is complete, faithful, or readable. Verify it yourself before relying on it.",
    "",
    "BetterOSF did **not** delete or change anything on OSF to produce this export, and never",
    "does. If you intend to remove the original, confirm this copy independently first.",
    "",
    `Full terms: https://betterosf.vercel.app/terms (version ${TERMS_VERSION})`,
    "",
  );

  return lines.join("\n");
}

/** Filename stem shared by the report, CSV and archive so they group together. */
export function reportFilename(guid: string, title: string, createdAt: string): string {
  const safe = (title || guid).replace(/[^\w.-]+/g, "_").slice(0, 60);
  const stamp = createdAt.slice(0, 19).replace(/[:T]/g, "-");
  return `betterosf-export_${safe}_${stamp}`;
}
