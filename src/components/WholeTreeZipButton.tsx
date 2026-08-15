"use client";

import { useRef, useState } from "react";
import { downloadTree, type ZipManifest, type ZipProgress } from "@/lib/download/browser-zip";
import { canChooseSaveLocation, type SaveOutcome } from "@/lib/transition/save-archive";
import { Spinner } from "@/components/Progress";

type State =
  | { phase: "idle" }
  | { phase: "working"; progress: ZipProgress | null }
  | { phase: "done"; outcome: SaveOutcome }
  | { phase: "fellback"; reason: string };

/**
 * Download the whole project tree as one ZIP.
 *
 * For a PUBLIC project the archive is assembled in this tab: the browser fetches one
 * Waterbutler `?zip=` stream per (node, provider) and nests them with `client-zip`, so not
 * one research byte passes through BetterOSF's servers. That removes the app's only real
 * cost risk — the server route's bandwidth is exactly the project's size — and with it the
 * 4.5 MB serverless response ceiling.
 *
 * For a PRIVATE project, and whenever the direct path fails for any reason, it hands off to
 * the server route, which is unchanged and still authenticates with the user's session.
 * The fallback is not a nicety: the CORS behaviour the direct path depends on is
 * undocumented (see `osfBrowserAuthHeader`), and a feature that breaks when OSF changes an
 * unrelated header would be worse than an expensive one.
 */
export function WholeTreeZipButton({ guid, isPublic }: { guid: string; isPublic: boolean }) {
  const [state, setState] = useState<State>({ phase: "idle" });
  const abort = useRef<AbortController | null>(null);

  const serverHref = `/api/zip/${guid}`;

  function fallBack(reason: string) {
    setState({ phase: "fellback", reason });
    window.location.href = serverHref;
  }

  async function run() {
    abort.current = new AbortController();
    setState({ phase: "working", progress: null });
    try {
      const res = await fetch(`/api/zip/${guid}/manifest`, { cache: "no-store" });
      if (!res.ok) throw new Error(`the project's structure could not be read (HTTP ${res.status})`);
      const manifest: ZipManifest = await res.json();

      const outcome = await downloadTree(manifest, {
        // No credential: a public project's bytes need none, and Waterbutler wants an
        // Authorization header present only so it will send CORS headers at all.
        token: null,
        signal: abort.current.signal,
        onProgress: (progress) => setState({ phase: "working", progress }),
      });
      setState({ phase: "done", outcome });
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        setState({ phase: "idle" });
        return;
      }
      fallBack(e instanceof Error ? e.message : String(e));
    }
  }

  if (!isPublic) {
    // Private projects need the session's own OSF token, which lives on the server. No
    // point pretending otherwise — this is the same link as before.
    return (
      <div>
        <a
          href={serverHref}
          className="block border rounded px-3 py-2 text-center hover:bg-neutral-50 dark:hover:bg-neutral-900"
        >
          <span aria-hidden="true">⬇</span> <span>Download whole project as ZIP</span>
        </a>
        <p className="text-xs text-neutral-500 mt-1">
          Bundles every storage provider, every component, every linked project. Per-provider archives
          are nested inside the outer ZIP. This one is assembled on BetterOSF&apos;s server, because a
          private project needs your signed-in session.
        </p>
      </div>
    );
  }

  if (state.phase === "working") {
    return (
      <div>
        <div className="flex items-center justify-center gap-2 border rounded px-3 py-2 text-sm">
          <Spinner />
          <span>
            {state.progress
              ? `Fetching ${state.progress.index} of ${state.progress.total} — ${state.progress.label}`
              : "Reading the project structure…"}
          </span>
        </div>
        <p className="text-xs text-neutral-500 mt-1">
          Files come straight from OSF to this tab. Keep the page open — the archive is only written
          when every part has arrived, so <strong>this browser holds the whole project at once</strong>{" "}
          while it is being built. For a very large project, the transition export is the better tool:
          it stages each file to disk instead.
        </p>
        <button
          type="button"
          onClick={() => abort.current?.abort()}
          className="mt-2 w-full rounded border px-3 py-1 text-sm"
        >
          Stop
        </button>
      </div>
    );
  }

  if (state.phase === "done") {
    return (
      <div>
        <p
          className={`rounded border px-3 py-2 text-sm ${
            state.outcome.saved
              ? "border-green-300 bg-green-50 dark:border-green-800 dark:bg-green-950"
              : "border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950"
          }`}
        >
          {state.outcome.saved
            ? state.outcome.picked
              ? `Saved as ${state.outcome.name}.`
              : `Downloaded as ${state.outcome.name}.`
            : state.outcome.cancelled
              ? "Save cancelled — nothing was written."
              : `The archive was built but could not be saved: ${state.outcome.error}`}
        </p>
        <button type="button" onClick={() => setState({ phase: "idle" })} className="mt-2 text-xs underline">
          Download again
        </button>
      </div>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => void run()}
        className="block w-full border rounded px-3 py-2 text-center hover:bg-neutral-50 dark:hover:bg-neutral-900"
      >
        <span aria-hidden="true">⬇</span> <span>Download whole project as ZIP</span>
      </button>
      <p className="text-xs text-neutral-500 mt-1">
        Bundles every storage provider, every component, every linked project. Per-provider archives are
        nested inside the outer ZIP.{" "}
        {canChooseSaveLocation()
          ? "You choose where to save it."
          : "It lands in your Downloads folder."}
      </p>
      {state.phase === "fellback" ? (
        <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
          The direct download did not work ({state.reason}), so BetterOSF is assembling it on the server
          instead. Your download should start on its own.
        </p>
      ) : null}
      <noscript>
        <a href={serverHref} className="text-xs underline">
          Download without JavaScript
        </a>
      </noscript>
    </div>
  );
}
