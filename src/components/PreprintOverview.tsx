import { notFound } from "next/navigation";
import { getPreprint } from "@/lib/osf/preprints";
import { OsfError } from "@/lib/osf/types";
import { Breadcrumb } from "@/components/Breadcrumb";
import { PinButton } from "@/components/PinButton";
import { RecordView } from "@/components/RecordView";
import { ViewerDispatcher } from "@/components/viewers/Dispatcher";

/**
 * Renders an OSF preprint: metadata + DOI + abstract, with the primary file
 * (the manuscript — almost always a PDF) shown inline via the same viewer and
 * same-origin download proxy used by the file-viewer route. Used by both the
 * flat `/<guid>` dispatcher and the canonical `/preprints/<guid>` route.
 */
export async function PreprintOverview({ guid }: { guid: string }) {
  let pp;
  try {
    pp = await getPreprint(guid);
  } catch (e) {
    if (e instanceof OsfError && e.code === "not_found") notFound();
    throw e;
  }

  const fileUrl = pp.primaryFile
    ? `/api/files/${guid}/download?u=${encodeURIComponent(pp.primaryFile.downloadUrl)}&name=${encodeURIComponent(pp.primaryFile.name)}`
    : null;
  const downloadHref = pp.primaryFile ? `${fileUrl}&dl=1` : null;

  return (
    <article className="max-w-4xl">
      <Breadcrumb
        crumbs={[
          { label: "Home", href: "/" },
          { label: "Preprints", href: "/search?type=preprints&q=" },
          { label: pp.title || guid, href: `/${guid}` },
        ]}
      />
      <header className="mb-5 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-3xl font-semibold">{pp.title || guid}</h1>
          {pp.authors.length > 0 && (
            <p className="mt-1 text-neutral-700 dark:text-neutral-300">{pp.authors.join(", ")}</p>
          )}
          <p className="text-sm text-neutral-600 mt-1">
            {pp.dateWithdrawn ? (
              <span className="text-amber-700 dark:text-amber-300">Withdrawn {pp.dateWithdrawn.slice(0, 10)}</span>
            ) : (
              <>Posted {pp.datePublished.slice(0, 10) || "—"}</>
            )}{" "}
            · <a href={pp.osfUrl} className="text-blue-600 hover:underline">View on OSF</a>
            {pp.doi && (
              <>
                {" "}· <a href={`https://doi.org/${pp.doi}`} className="text-blue-600 hover:underline">doi:{pp.doi}</a>
              </>
            )}
          </p>
          {pp.supplementalNodeId && (
            <p className="text-sm mt-1">
              Supplemental materials:{" "}
              <a href={`/${pp.supplementalNodeId}`} className="text-blue-600 hover:underline">{pp.supplementalNodeId}</a>
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {downloadHref && (
            <a href={downloadHref} download={pp.primaryFile?.name} className="text-sm border rounded px-2 py-1 hover:bg-neutral-100 dark:hover:bg-neutral-800">
              <span aria-hidden="true">⬇</span> Download
            </a>
          )}
          <PinButton refEntry={{ id: guid, title: pp.title || guid, kind: "preprint" }} />
        </div>
      </header>
      <RecordView refEntry={{ id: guid, title: pp.title || guid, kind: "preprint" }} />

      {pp.description && (
        <section className="mb-6">
          <h2 className="text-xl font-semibold mb-2">Abstract</h2>
          <p className="whitespace-pre-wrap text-neutral-700 dark:text-neutral-300">{pp.description}</p>
        </section>
      )}

      <section>
        <h2 className="text-xl font-semibold mb-2">Manuscript</h2>
        {fileUrl && pp.primaryFile ? (
          <div className="border rounded dark:border-neutral-800 min-h-[60vh]">
            <ViewerDispatcher filename={pp.primaryFile.name} url={fileUrl} sizeBytes={pp.primaryFile.size} />
          </div>
        ) : (
          <p className="text-neutral-500">No manuscript file is available for this preprint.</p>
        )}
      </section>
    </article>
  );
}
