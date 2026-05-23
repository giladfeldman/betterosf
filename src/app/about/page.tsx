export const metadata = { title: "About — BetterOSF" };

export default function AboutPage() {
  return (
    <article className="max-w-3xl space-y-4 text-neutral-700 dark:text-neutral-300 leading-relaxed [&_h1]:text-2xl [&_h1]:font-semibold [&_h1]:text-neutral-900 dark:[&_h1]:text-neutral-100 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:mt-6 [&_h2]:mb-2 [&_h2]:text-neutral-900 dark:[&_h2]:text-neutral-100 [&_ul]:list-disc [&_ul]:list-inside [&_ul]:space-y-1 [&_code]:font-mono [&_code]:text-sm [&_code]:bg-neutral-100 dark:[&_code]:bg-neutral-800 [&_code]:px-1 [&_code]:rounded">
      <h1>About BetterOSF</h1>
      <p>
        BetterOSF is a community-built alternative interface for the{" "}
        <a href="https://osf.io" className="text-blue-600 hover:underline">Open Science Framework</a>.
      </p>
      <p>
        The official OSF UI was redesigned in October 2025 and introduced regressions that broke established
        workflows for many researchers — components lists silently truncated, file trees fragmented across
        storage providers, search results not openable in new tabs, no easy way to download a whole project.
        BetterOSF fixes these by sitting on top of OSF&apos;s public API and presenting the same data with the
        affordances we believe researchers actually need.
      </p>
      <h2>What works</h2>
      <ul>
        <li>Anonymous browsing of public OSF projects via shareable URLs (<code>betterosf.vercel.app/&lt;guid&gt;</code> mirrors <code>osf.io/&lt;guid&gt;</code>)</li>
        <li>Full component, linked-project, and registration lists — no &ldquo;Load more&rdquo;</li>
        <li>Unified file tree across every storage provider (OSF Storage, Google Drive, Dropbox, GitHub, S3, etc.)</li>
        <li>One-click whole-project ZIP downloads</li>
        <li>Real anchor links everywhere — right-click → open in new tab works</li>
        <li>Global search across projects / files / registrations / users</li>
        <li>Registration detail pages with schema responses</li>
      </ul>
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
