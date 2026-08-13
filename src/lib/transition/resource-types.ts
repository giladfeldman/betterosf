/**
 * Zenodo's resource-type vocabulary.
 *
 * ⚠️ **Every id below was copied verbatim from
 * `GET https://sandbox.zenodo.org/api/vocabularies/resourcetypes?size=100` on 2026-08-13**
 * — all 43 of them, ids and English titles both. None was typed from memory.
 *
 * This is the same discipline the licence map in `crosswalk.ts` had to learn the hard way:
 * six invented licence keys silently never matched, so every non-commercial deposit would
 * have reached Zenodo with no machine-readable licence at all. A vocabulary written from
 * memory does not fail loudly — it fails by never firing, and the tests written from the
 * same assumption agree with it.
 *
 * `npm run test:live-zenodo` re-checks every id against the live vocabulary, so drift
 * surfaces as a failing probe rather than as a rejected deposit.
 *
 * The resource type is **never inferred** from OSF's category. OSF's vocabulary
 * ("project", "analysis", "hypothesis") does not map onto this one, and a wrong
 * resource_type corrupts DataCite indexing. The user picks it.
 */

export type ResourceType = {
  id: string;
  /** Zenodo's own English title. */
  title: string;
  /** Disambiguated for a flat list — three entries are titled "Other" upstream. */
  label: string;
};

/** The handful an OSF project is most likely to be, offered first. */
export const SUGGESTED_RESOURCE_TYPE_IDS = [
  "dataset",
  "software",
  "publication-preprint",
  "publication-article",
  "presentation",
  "poster",
  "lesson",
  "other",
] as const;

export const RESOURCE_TYPES: ResourceType[] = [
  { id: "dataset", title: "Dataset", label: "Dataset" },
  { id: "software", title: "Software", label: "Software" },
  { id: "publication-preprint", title: "Preprint", label: "Preprint" },
  { id: "publication-article", title: "Journal article", label: "Journal article" },
  { id: "presentation", title: "Presentation", label: "Presentation" },
  { id: "poster", title: "Poster", label: "Poster" },
  { id: "lesson", title: "Lesson", label: "Lesson" },
  { id: "other", title: "Other", label: "Other" },
  { id: "publication", title: "Publication", label: "Publication (unspecified)" },
  { id: "publication-annotationcollection", title: "Annotation collection", label: "Annotation collection" },
  { id: "publication-book", title: "Book", label: "Book" },
  { id: "publication-section", title: "Book chapter", label: "Book chapter" },
  { id: "software-computationalnotebook", title: "Computational notebook", label: "Computational notebook" },
  { id: "publication-conferencepaper", title: "Conference paper", label: "Conference paper" },
  { id: "publication-conferenceproceeding", title: "Conference proceeding", label: "Conference proceeding" },
  { id: "publication-datapaper", title: "Data paper", label: "Data paper" },
  { id: "image-diagram", title: "Diagram", label: "Diagram (image)" },
  { id: "image-drawing", title: "Drawing", label: "Drawing (image)" },
  { id: "event", title: "Event", label: "Event" },
  { id: "image-figure", title: "Figure", label: "Figure (image)" },
  { id: "image", title: "Image", label: "Image" },
  { id: "publication-journal", title: "Journal", label: "Journal" },
  { id: "model", title: "Model", label: "Model" },
  { id: "image-other", title: "Other", label: "Other (image)" },
  { id: "publication-other", title: "Other", label: "Other (publication)" },
  { id: "publication-datamanagementplan", title: "Output management plan", label: "Output management plan" },
  { id: "publication-patent", title: "Patent", label: "Patent" },
  { id: "publication-peerreview", title: "Peer review", label: "Peer review" },
  { id: "image-photo", title: "Photo", label: "Photo (image)" },
  { id: "physicalobject", title: "Physical object", label: "Physical object" },
  { id: "image-plot", title: "Plot", label: "Plot (image)" },
  { id: "publication-deliverable", title: "Project deliverable", label: "Project deliverable" },
  { id: "publication-milestone", title: "Project milestone", label: "Project milestone" },
  { id: "publication-proposal", title: "Proposal", label: "Proposal" },
  { id: "publication-report", title: "Report", label: "Report" },
  { id: "publication-softwaredocumentation", title: "Software documentation", label: "Software documentation" },
  { id: "publication-standard", title: "Standard", label: "Standard" },
  { id: "publication-taxonomictreatment", title: "Taxonomic treatment", label: "Taxonomic treatment" },
  { id: "publication-technicalnote", title: "Technical note", label: "Technical note" },
  { id: "publication-dissertation", title: "Thesis", label: "Thesis" },
  { id: "video", title: "Video/Audio", label: "Video / Audio" },
  { id: "workflow", title: "Workflow", label: "Workflow" },
  { id: "publication-workingpaper", title: "Working paper", label: "Working paper" },
];

/** Is this a resource type Zenodo actually publishes? Rejects anything not on the list. */
export function isKnownResourceType(id: string): boolean {
  return RESOURCE_TYPES.some((t) => t.id === id);
}

/**
 * The default offered in the UI.
 *
 * "dataset" is a DEFAULT the user sees and can change, not an inference from OSF's
 * category — the distinction the crosswalk's fidelity table records as `user_supplied`.
 */
export const DEFAULT_RESOURCE_TYPE_ID = "dataset";
