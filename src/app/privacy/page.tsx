export const metadata = { title: "Privacy — BetterOSF" };

export default function PrivacyPage() {
  return (
    <article className="max-w-3xl space-y-4 text-neutral-700 dark:text-neutral-300 leading-relaxed [&_h1]:text-2xl [&_h1]:font-semibold [&_h1]:text-neutral-900 dark:[&_h1]:text-neutral-100 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:mt-6 [&_h2]:mb-2 [&_h2]:text-neutral-900 dark:[&_h2]:text-neutral-100 [&_ul]:list-disc [&_ul]:list-inside [&_ul]:space-y-1">
      <h1>Privacy</h1>
      <p>
        BetterOSF is an alternative web interface for the{" "}
        <a href="https://osf.io" className="text-blue-600 hover:underline">Open Science Framework</a>.
        All data shown comes from OSF&apos;s public API. We don&apos;t own any of it.
      </p>
      <h2>What we store</h2>
      <ul>
        <li>
          <strong>Session cookies</strong> for users who sign in with OSF. These hold an encrypted OAuth
          access token in an httpOnly cookie (set by Auth.js). The cookie is the only place your token lives;
          we have no database.
        </li>
        <li>
          <strong>Short-lived counters</strong> in Vercel KV (Redis) for rate-limiting and quota tracking
          (per-IP page-nav counts, daily app-token usage). These auto-expire within minutes to a day.
        </li>
        <li>
          <strong>Browser localStorage</strong> (user-side) for any future preferences you set.
        </li>
      </ul>
      <h2>What we don&apos;t store</h2>
      <ul>
        <li>No analytics service. No third-party telemetry.</li>
        <li>No relational database. No long-term user data.</li>
        <li>We don&apos;t cache file contents — downloads stream straight from OSF&apos;s storage.</li>
      </ul>
      <h2>What we send to OSF</h2>
      <p>
        Every page load makes one or more calls to the OSF API. For anonymous viewers, those calls are
        authenticated with a single application-owned OSF Personal Access Token. For signed-in users,
        we use the user&apos;s own OAuth access token.
      </p>
      <h2>Sign out</h2>
      <p>
        Use the &ldquo;Sign out&rdquo; button in the header to clear your session cookie. We don&apos;t revoke
        the OAuth token server-side (would require an OSF endpoint and adds failure modes); the token sits
        unused until OSF expires it on their schedule.
      </p>
      <h2>Source code</h2>
      <p>
        BetterOSF is open source at{" "}
        <a href="https://github.com/giladfeldman/betterosf" className="text-blue-600 hover:underline">github.com/giladfeldman/betterosf</a>.
      </p>
    </article>
  );
}
