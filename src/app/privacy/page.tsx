export const metadata = { title: "Privacy - BetterOSF" };

export default function PrivacyPage() {
  return (
    <article className="max-w-3xl space-y-4 text-neutral-700 dark:text-neutral-300 leading-relaxed [&_h1]:text-2xl [&_h1]:font-semibold [&_h1]:text-neutral-900 dark:[&_h1]:text-neutral-100 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:mt-6 [&_h2]:mb-2 [&_h2]:text-neutral-900 dark:[&_h2]:text-neutral-100 [&_ul]:list-disc [&_ul]:list-inside [&_ul]:space-y-1">
      <h1>Privacy</h1>
      <p>
        BetterOSF is a Scirenity research utility and alternative web interface for the{" "}
        <a href="https://osf.io" className="text-blue-600 hover:underline">Open Science Framework</a>.
        All data shown comes from OSF&apos;s public API. We don&apos;t own any of it.
      </p>

      <h2>What we store</h2>
      <ul>
        <li>
          <strong>Session cookies</strong> for users who sign in with OSF. These hold an encrypted OAuth
          access token in an httpOnly cookie set by Auth.js. The cookie is the only place your token lives;
          we have no relational database.
        </li>
        <li>
          <strong>Short-lived counters</strong> for rate-limiting and quota tracking, such as per-IP navigation
          counts and daily app-token usage. These expire automatically.
        </li>
        <li>
          <strong>Browser localStorage</strong> on your device for preferences, split-pane width, pins, recent
          items, and theme choices.
        </li>
      </ul>

      <h2>What we don&apos;t store</h2>
      <ul>
        <li>No analytics service. No third-party telemetry.</li>
        <li>No long-term user database.</li>
        <li>We don&apos;t cache file contents; previews and downloads stream from OSF&apos;s storage.</li>
      </ul>

      <h2>What we send to OSF</h2>
      <p>
        Every project or file page makes one or more calls to OSF. Anonymous viewers use a BetterOSF app token
        when needed, with anonymous fallback for public endpoints. Signed-in users use their own OSF OAuth token.
      </p>

      <h2>Scirenity platform links</h2>
      <p>
        BetterOSF links to other Scirenity apps and pages, including{" "}
        <a href="https://scirenity.com" className="text-blue-600 hover:underline">scirenity.com</a>,{" "}
        <a href="https://scimeto.app" className="text-blue-600 hover:underline">scimeto.app</a>, and{" "}
        <a href="https://escimate.app" className="text-blue-600 hover:underline">escimate.app</a>.
        Those sites have their own hosting and policies; BetterOSF does not share OSF session tokens with them.
      </p>

      <h2>Sign out</h2>
      <p>
        Use the Sign out button in the header to clear your BetterOSF session cookie. Local browser preferences
        can be cleared from your browser&apos;s site data controls.
      </p>

      <h2>Source code</h2>
      <p>
        BetterOSF is open source at{" "}
        <a href="https://github.com/giladfeldman/betterosf" className="text-blue-600 hover:underline">github.com/giladfeldman/betterosf</a>.
      </p>
    </article>
  );
}
