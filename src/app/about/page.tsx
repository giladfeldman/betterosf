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

      <h2>Part of Scirenity</h2>
      <p>
        Explore the broader platform at{" "}
        <a href="https://scirenity.com" className="text-blue-600 hover:underline">scirenity.com</a>.
        Related apps include{" "}
        <a href="https://scimeto.app" className="text-blue-600 hover:underline">SciMeto</a>{" "}
        and{" "}
        <a href="https://escimate.app" className="text-blue-600 hover:underline">ESCI Mate</a>.
      </p>

      <h2>Not affiliated with COS</h2>
      <p>
        BetterOSF is not affiliated with the Center for Open Science. All data lives on OSF. We&apos;re a
        wrapper, not a fork. Sign in with your existing OSF account; no separate registration.
      </p>

      <h2>Open source</h2>
      <p>
        Code at <a href="https://github.com/giladfeldman/betterosf" className="text-blue-600 hover:underline">github.com/giladfeldman/betterosf</a>.
        Issues and PRs welcome.
      </p>
    </article>
  );
}
