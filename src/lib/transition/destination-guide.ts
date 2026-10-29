/**
 * "Where should this project go?" — three questions, one suggested home.
 *
 * The rules follow Lakens, "Which data repository should you use?" (2026-08,
 * https://daniellakens.blogspot.com/2026/08/which-data-repository-should-you-use.html):
 * - Pseudonymised data (re-identifiable via a key) stays under the GDPR. Zenodo is run by
 *   CERN, which will not sign a data-processing agreement, so it should not go to Zenodo;
 *   use DataverseNL or your institution's repository.
 * - Anonymised data, materials and code: Zenodo, Harvard Dataverse or ResearchBox.
 * - Code: GitHub linked to Zenodo, so each release gets a DOI.
 * - Point-and-click users find ResearchBox easiest.
 *
 * Upload-by-software facts behind "how" (probed 2026-10-29, docs/licence-check-and-destinations.md):
 * only Zenodo has a BetterOSF transfer; ResearchBox's API is download-only; DataverseNL
 * blocks browser uploads. Every other destination gets the export ZIP plus steps.
 *
 * A suggestion from three answers, not advice — the copy says so, as the transition terms do.
 */

export type DataKind = "pseudonymised" | "anonymised-or-none";
export type ContentKind = "code" | "data-materials";
export type Style = "point-and-click" | "either";

export type GuideAnswers = { data: DataKind; content: ContentKind; style: Style };

export type DestinationId = "zenodo" | "dataverse-nl" | "institutional" | "harvard-dataverse" | "researchbox" | "github";

export type Destination = {
  id: DestinationId;
  name: string;
  url: string;
  /** True only where BetterOSF uploads for you. */
  automatic: boolean;
  steps: string[];
};

const EXPORT_STEP = "Export this project below and download the ZIP. Unzip it on your computer.";
const DOI_STEP =
  "When the new record has a DOI, add it to your OSF project's description (before 19 February 2027) so readers of old links can find the new home.";

export const DESTINATIONS: Record<DestinationId, Destination> = {
  zenodo: {
    id: "zenodo",
    name: "Zenodo",
    url: "https://zenodo.org",
    automatic: true,
    steps: [
      "Export below, then answer yes to “Also put a copy on Zenodo?”: BetterOSF uploads every file and checks each one against OSF's checksum.",
      "Review the draft on Zenodo, then publish to get a DOI.",
      DOI_STEP,
    ],
  },
  "dataverse-nl": {
    id: "dataverse-nl",
    name: "DataverseNL",
    url: "https://dataverse.nl",
    automatic: false,
    steps: [
      "DataverseNL is for researchers at its partner institutions. Check that yours is one; if not, use your institution's repository.",
      EXPORT_STEP,
      "On DataverseNL, create a new dataset and upload the files from the ZIP's data/ folder.",
      "Set restricted access on the pseudonymised files and choose the licence in the dataset's Terms.",
      DOI_STEP,
    ],
  },
  institutional: {
    id: "institutional",
    name: "Your institution's repository",
    url: "https://www.re3data.org",
    automatic: false,
    steps: [
      "Ask your library or research-data office which repository your institution uses for personal data (re3data.org lists repositories by institution).",
      EXPORT_STEP,
      "Upload the files from the ZIP's data/ folder and keep EXPORT-REPORT.md with them as a record of the move.",
      DOI_STEP,
    ],
  },
  "harvard-dataverse": {
    id: "harvard-dataverse",
    name: "Harvard Dataverse",
    url: "https://dataverse.harvard.edu",
    automatic: false,
    steps: [
      EXPORT_STEP,
      "On Harvard Dataverse, sign in, choose Add Data → New Dataset, and fill in the metadata (EXPORT-REPORT.md has the title, contributors and OSF link).",
      "Upload the files from the ZIP's data/ folder. You can upload them as one .zip: where the installation allows it, Dataverse unpacks it and keeps the folders (up to 1,000 files by default). If it stays a single .zip, upload the files themselves instead.",
      "Choose the licence in the dataset's Terms, then publish.",
      DOI_STEP,
    ],
  },
  researchbox: {
    id: "researchbox",
    name: "ResearchBox",
    url: "https://researchbox.org",
    automatic: false,
    steps: [
      EXPORT_STEP,
      "On ResearchBox, create a box for the paper and upload the files into its sections (data, code, materials). ResearchBox has no upload API, so this part is by hand.",
      "ResearchBox keeps a backup copy on Zenodo, and gives an anonymous link for peer review.",
      DOI_STEP,
    ],
  },
  github: {
    id: "github",
    name: "GitHub, linked to Zenodo",
    url: "https://github.com",
    automatic: false,
    steps: [
      "On zenodo.org, sign in, open the GitHub page in your account settings, and switch your repository on — before you make a release.",
      EXPORT_STEP,
      "Create a GitHub repository and add the files from the ZIP's data/ folder. GitHub blocks files over 100 MB and the web upload takes files up to 25 MB each — put large data on Zenodo instead.",
      "Add LICENSE.txt from the ZIP, then make a release: Zenodo archives it and gives it a DOI.",
      DOI_STEP,
    ],
  },
};

export type Suggestion = { primary: Destination; alternatives: Destination[]; reason: string };

export function suggestDestination(a: GuideAnswers): Suggestion {
  const d = DESTINATIONS;
  if (a.data === "pseudonymised") {
    return {
      primary: d["dataverse-nl"],
      alternatives: [d.institutional],
      reason:
        "Pseudonymised data is still personal data under the GDPR. Zenodo cannot sign a data-processing agreement, so Lakens recommends DataverseNL or your institution's repository for it. Anonymised files from the same project can still go to Zenodo.",
    };
  }
  if (a.content === "code") {
    return {
      primary: d.github,
      alternatives: [d.zenodo],
      reason:
        "For code, Lakens suggests GitHub linked to Zenodo: GitHub for working on it, Zenodo for a DOI on each release. If the code is finished, transferring straight to Zenodo is simpler.",
    };
  }
  if (a.style === "point-and-click") {
    return {
      primary: d.researchbox,
      alternatives: [d["harvard-dataverse"], d.zenodo],
      reason:
        "Lakens finds ResearchBox the easiest for uploading by hand, and it builds its metadata from your files. Harvard Dataverse is the other easy option for anonymised data.",
    };
  }
  return {
    primary: d.zenodo,
    alternatives: [d["harvard-dataverse"], d.researchbox],
    reason:
      "Anonymised data and materials can go to Zenodo, which BetterOSF can transfer to for you and check file by file. Harvard Dataverse is a good alternative if you want folders kept or searchable tables.",
  };
}

/**
 * `LICENSE.txt` for the export ZIP, or null when OSF asserts no reuse licence — writing a
 * licence file for "No license" or "Other" would claim a licence the project never had.
 * Includes OSF's stored licence text when there is one.
 */
export function renderLicenceFile(
  licence: { name: string; text: string | null; copyrightHolders: string[]; year: string | null } | null,
  project: { title: string; osfUrl: string },
): string | null {
  if (!licence) return null;
  const n = licence.name.trim().toLowerCase();
  if (n === "" || n === "no license" || n === "other") return null;
  const holders = licence.copyrightHolders.filter((h) => h.trim().length > 0);
  const lines = [
    project.title,
    project.osfUrl,
    "",
    `Licensed under: ${licence.name}`,
  ];
  if (holders.length > 0 || licence.year) {
    lines.push(`Copyright ${licence.year ? `${licence.year} ` : ""}${holders.join(", ")}`.trimEnd());
  }
  lines.push("", "This file records the licence the project carried on OSF when BetterOSF exported it.");
  if (licence.text && licence.text.trim()) lines.push("", "----", "", licence.text.trim());
  lines.push("");
  return lines.join("\n");
}
