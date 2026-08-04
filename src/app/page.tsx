import Link from "next/link";
import { GuidEntryForm } from "@/components/GuidEntryForm";
import { PinnedRecentPanels } from "@/components/PinnedRecentPanels";
import { APP_VERSION_LABEL } from "@/lib/version";

export const metadata = {
  title: "BetterOSF — browse OSF projects without the friction",
  description:
    "A faster, researcher-friendly reader for the Open Science Framework: one unified file tree across every storage provider, in-browser previews for 20+ formats, whole-project ZIP downloads, and deep links that actually work.",
};

/**
 * Anonymous landing page.
 *
 * Deliberately contains NO example project links: rendering them invited every
 * first-time visitor to open Many Labs 2 / RPP, two of the largest projects on
 * OSF, which cost dozens of OSF API calls each and made the homepage the most
 * expensive page in the app (user report 2026-08-04).
 *
 * Every claim below must correspond to functionality that actually ships — the
 * betterosf-cleanup skill re-checks this page against the feature set on each
 * run. If a feature is removed, the copy here is removed in the same change.
 */

const CAPABILITIES = [
  {
    title: "One tree, every provider",
    body: "OSF splits files across osfstorage, GitHub, Dropbox, Google Drive and more, each behind its own tab. BetterOSF merges them into a single navigator you can expand, filter, and depth-limit.",
  },
  {
    title: "Previews that open in place",
    body: "PDF, DOCX, PPTX, XLSX, CSV, R, Python, Stata, Markdown, JSON, Jupyter notebooks, images, audio and video render in the browser — no download-then-open round trip.",
  },
  {
    title: "Deep links that survive",
    body: "Every folder and file has a real URL with a real anchor. Middle-click, right-click → open in new tab, and bookmarking all behave the way you expect.",
  },
  {
    title: "Download a whole project as one ZIP",
    body: "Stream an entire project — root, every component, every linked project, across every provider — into a single archive. Failures are recorded inside the ZIP instead of silently truncating it.",
  },
  {
    title: "Search across OSF",
    body: "Find projects, files, registrations and users from one page, or search within a single project including collapsed folders.",
  },
  {
    title: "Upload straight to OSF",
    body: "Sign in with OSF to drag in files and folders, or extract a ZIP into a folder tree. Uploads go browser-to-OSF directly, so multi-gigabyte files aren't capped by our servers.",
  },
];

const STEPS = [
  {
    n: 1,
    title: "Paste a link or GUID",
    body: "Any OSF project, component, registration, preprint, user, or file URL — or just the 5-character GUID.",
  },
  {
    n: 2,
    title: "BetterOSF resolves it",
    body: "We work out what kind of thing it is and load the metadata plus the full file tree in one pass.",
  },
  {
    n: 3,
    title: "Read, search, download",
    body: "Preview files inline, filter the tree, grab a folder or the whole project as a ZIP.",
  },
];

export default function Landing() {
  return (
    <div className="mx-auto max-w-5xl">
      {/* Hero */}
      <section className="mb-12 border-b border-neutral-200 pb-10 dark:border-neutral-800">
        <p className="mb-3 text-sm font-medium text-blue-600 dark:text-blue-400">
          For researchers reading other people&apos;s open data
        </p>
        <h1 className="mb-4 text-4xl font-semibold tracking-tight sm:text-5xl">
          Browse OSF without the friction.
        </h1>
        <p className="mb-6 max-w-2xl text-lg text-neutral-700 dark:text-neutral-300">
          The Open Science Framework hosts the data behind a huge share of published psychology and
          social science. Actually <em>reading</em> a project means clicking through provider tabs,
          expanding one folder at a time, and downloading files just to see what they contain.
          BetterOSF gives you one merged file tree, in-browser previews, and links that work.
        </p>
        <GuidEntryForm />
        <p className="mt-3 text-sm text-neutral-500">
          Free · No account needed for public projects · Read-only unless you sign in
        </p>
      </section>

      {/* Workspace — only renders once the visitor has history of their own. */}
      <div className="mb-12">
        <PinnedRecentPanels showPinned />
      </div>

      {/* What it does */}
      <section className="mb-12">
        <h2 className="mb-1 text-2xl font-semibold">What it does</h2>
        <p className="mb-6 text-neutral-600 dark:text-neutral-400">
          BetterOSF is a reader for OSF, not a replacement. Your data stays on OSF; nothing is copied
          anywhere else.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          {CAPABILITIES.map((c) => (
            <div key={c.title} className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
              <h3 className="mb-1 font-semibold">{c.title}</h3>
              <p className="text-sm text-neutral-600 dark:text-neutral-400">{c.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className="mb-12">
        <h2 className="mb-6 text-2xl font-semibold">How it works</h2>
        <ol className="grid gap-4 sm:grid-cols-3">
          {STEPS.map((s) => (
            <li key={s.n} className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
              <span className="mb-2 inline-flex h-7 w-7 items-center justify-center rounded-full bg-blue-600 text-sm font-semibold text-white">
                {s.n}
              </span>
              <h3 className="mb-1 font-semibold">{s.title}</h3>
              <p className="text-sm text-neutral-600 dark:text-neutral-400">{s.body}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* Trust / data handling */}
      <section className="mb-12 rounded-lg border border-neutral-200 p-5 dark:border-neutral-800">
        <h2 className="mb-3 text-xl font-semibold">Where your data goes</h2>
        <ul className="space-y-2 text-sm text-neutral-700 dark:text-neutral-300">
          <li>
            <strong>Files stay on OSF.</strong> BetterOSF reads through the public OSF API and streams
            downloads through to you. It never stores your research files.
          </li>
          <li>
            <strong>Public browsing needs no account.</strong> Sign in only to see private projects or
            to upload.
          </li>
          <li>
            <strong>Your workspace is local.</strong> Recently-opened items live in your browser. Signed
            in, bookmarks and preferences sync to a database hosted in the EU.
          </li>
          <li>
            <strong>Deleting is deliberate.</strong> OSF has no trash — so BetterOSF makes you download a
            verified backup before it will delete anything, and never offers deletion on registrations.
          </li>
        </ul>
        <p className="mt-3 text-sm">
          <Link href="/privacy" className="text-blue-600 hover:underline dark:text-blue-400">
            Read the privacy note
          </Link>
        </p>
      </section>

      {/* Footer CTA */}
      <section className="mb-4 border-t border-neutral-200 pt-8 dark:border-neutral-800">
        <h2 className="mb-2 text-xl font-semibold">Try it on a project you already know</h2>
        <p className="mb-4 max-w-2xl text-sm text-neutral-600 dark:text-neutral-400">
          Paste any OSF link above. There&apos;s also a{" "}
          <Link href="/bookmarklet" className="text-blue-600 hover:underline dark:text-blue-400">
            bookmarklet
          </Link>{" "}
          that jumps from any osf.io page straight to the BetterOSF view of it, and a{" "}
          <Link href="/search" className="text-blue-600 hover:underline dark:text-blue-400">
            search page
          </Link>{" "}
          if you don&apos;t have a link yet.
        </p>
        <p className="text-sm text-neutral-500">
          Running {APP_VERSION_LABEL}. Something broken or missing?{" "}
          <Link href="/feedback" className="text-blue-600 hover:underline dark:text-blue-400">
            Report it
          </Link>{" "}
          — it goes straight to the maintainer.
        </p>
      </section>
    </div>
  );
}
