export const metadata = { title: "About - BetterOSF" };

export default function AboutPage() {
  return (
    <article className="max-w-3xl space-y-4 text-neutral-700 dark:text-neutral-300 leading-relaxed [&_h1]:text-2xl [&_h1]:font-semibold [&_h1]:text-neutral-900 dark:[&_h1]:text-neutral-100 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:mt-6 [&_h2]:mb-2 [&_h2]:text-neutral-900 dark:[&_h2]:text-neutral-100 [&_ul]:list-disc [&_ul]:list-inside [&_ul]:space-y-1 [&_code]:font-mono [&_code]:text-sm [&_code]:bg-neutral-100 dark:[&_code]:bg-neutral-800 [&_code]:px-1 [&_code]:rounded">
      <h1>About BetterOSF</h1>
      <p>
        BetterOSF is a Scirenity research utility and community-built alternative interface for the{" "}
        <a href="https://osf.io" className="text-blue-600 hover:underline">Open Science Framework</a>.
      </p>
      <p>
        Scirenity is a platform for practical research tools: small, focused apps that make open science,
        research integrity, evidence synthesis, and day-to-day scholarly work easier. BetterOSF is the OSF
        browsing and file-access piece of that ecosystem.
      </p>
      <p>
        BetterOSF sits on top of OSF&apos;s public API and presents the same data with affordances researchers
        need: a unified tree, file previews, direct downloads, resilient deep links, and fewer slow round trips.
      </p>

      <h2>What works</h2>
      <ul>
        <li>Anonymous browsing of public OSF projects via shareable URLs (<code>betterosf.vercel.app/&lt;guid&gt;</code> mirrors <code>osf.io/&lt;guid&gt;</code>)</li>
        <li>Full component, linked-project, and registration lists without hidden pagination traps</li>
        <li>Unified file tree across storage providers such as OSF Storage, Google Drive, Dropbox, GitHub, S3, and Box</li>
        <li>Whole-project, folder, and selected-item ZIP downloads</li>
        <li>In-browser previews for common research formats including PDF, DOCX, XLSX, PPTX, CSV, code, notebooks, media, and images</li>
        <li>Real anchor links everywhere, so right-click open-in-new-tab still works</li>
        <li>Global search across projects, files, registrations, and users</li>
        <li>Registration detail pages with schema responses</li>
      </ul>

      <h2>Part of Scirenity — related apps &amp; links</h2>
      <p>
        BetterOSF is part of Scirenity: a family of focused research tools built around speed,
        transparency, and researcher-friendly workflows.
      </p>
      <div className="not-prose grid gap-4 sm:grid-cols-2">
        {[
          { title: "Scirenity", href: "https://scirenity.com", description: "The broader platform for focused research tools." },
          { title: "SciMeto", href: "https://scimeto.app", description: "A related Scirenity app for manuscript and research-integrity workflows." },
          { title: "ESCI Mate", href: "https://escimate.app", description: "A related Scirenity app for effect-size and evidence-synthesis workflows." },
          { title: "OSF", href: "https://osf.io", description: "The Open Science Framework. BetterOSF displays OSF-hosted data." },
          { title: "GitHub", href: "https://github.com/giladfeldman/betterosf", description: "Source code, issues, and contribution history." },
        ].map((link) => (
          <a
            key={link.href}
            href={link.href}
            className="block rounded border border-neutral-200 p-4 hover:border-blue-400 hover:bg-blue-50/40 dark:border-neutral-800 dark:hover:border-blue-500 dark:hover:bg-blue-950/20"
          >
            <span className="block text-lg font-semibold text-blue-600">{link.title}</span>
            <span className="mt-1 block text-sm text-neutral-700 dark:text-neutral-300">{link.description}</span>
          </a>
        ))}
      </div>

      <h2>Not affiliated with COS</h2>
      <p>
        BetterOSF is not affiliated with the Center for Open Science. All data lives on OSF. We&apos;re a
        wrapper, not a fork. Sign in with your existing OSF account; no separate registration.
      </p>

      <h2>Open source</h2>
      <p>
        Code at <a href="https://github.com/giladfeldman/betterosf" className="text-blue-600 hover:underline">github.com/giladfeldman/betterosf</a>.
        Licensed under AGPL-3.0. Issues and PRs welcome.
      </p>
      <section id="cite" data-license-citation className="space-y-3">
        <h2>Licence and citation</h2>
        <p>
          Copyright (C) 2026 Gilad Feldman. This software is licensed under the{" "}
          <a href="https://www.gnu.org/licenses/agpl-3.0.html" className="text-blue-600 hover:underline">GNU Affero General Public License v3.0</a>{" "}
          (AGPL-3.0-only). Anyone may use, modify and share it, including commercially, provided the source of
          any modified version is published under the same licence, including when it is offered as a hosted
          service. Commercial licences without these conditions are available from the author. The source code is at{" "}
          <a href="https://github.com/giladfeldman/betterosf" className="text-blue-600 hover:underline">github.com/giladfeldman/betterosf</a>.
        </p>
        <h3 className="font-semibold text-neutral-900 dark:text-neutral-100">How to cite</h3>
        <p>
          Feldman, G. (2026). <em>betterosf: A faster, friendlier interface for the Open Science Framework (OSF): browse, search, export and migrate your projects.</em> (Version 1.14.4) [Computer software]. https://betterosf.vercel.app
        </p>
        <pre className="overflow-x-auto rounded border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 p-3 text-sm">{`@software{feldman_betterosf_2026,
  author = {Feldman, Gilad},
  title = {betterosf: A faster, friendlier interface for the Open Science Framework (OSF): browse, search, export and migrate your projects.},
  year = {2026},
  version = {1.14.4},
  url = {https://betterosf.vercel.app},
  license = {AGPL-3.0-only}
}`}</pre>
        <p>
          Author: Gilad Feldman, <a href="https://orcid.org/0000-0003-2812-6599" className="text-blue-600 hover:underline">ORCID 0000-0003-2812-6599</a>.
        </p>
      </section>
    </article>
  );
}
