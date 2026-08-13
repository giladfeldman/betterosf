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
          access token and (when OSF issued one) a refresh token in an httpOnly cookie set by Auth.js.
          BetterOSF renews the access token server-side via the refresh token so you are not asked to
          reconnect every hour.
        </li>
        <li>
          <strong>Account + preference data</strong> in a Neon Postgres database hosted in the EU
          (Frankfurt, <code>aws-eu-central-1</code>) when you sign in: your OSF user id, display name,
          email if OSF provided one, synced bookmarks/favorites, and view preferences. This lets pins
          and settings follow you across devices. We do not store your OSF access or refresh tokens in
          the database — those stay in the session cookie only.
        </li>
        <li>
          <strong>Operational logs</strong> (errors and diagnostics) in the same EU database for
          administrators, retained for a short window and redacted of secrets.
        </li>
        <li>
          <strong>Short-lived counters</strong> for rate-limiting and quota tracking, such as per-IP navigation
          counts and daily app-token usage. These expire automatically.
        </li>
        <li>
          <strong>A record of your agreement to the transition terms</strong>, if you use the export and
          transfer tools. It stores your OSF user id, which version of the terms you agreed to, when, your
          browser&apos;s user-agent string, and — where a typed confirmation was required — the phrase you
          typed and the number of items it covered. This is evidence that you were shown the terms before an
          irreversible step, so it is kept rather than deleted, and it survives with your OSF id attached even
          if your BetterOSF account row is removed.
        </li>
        <li>
          <strong>Nothing about the contents of an export.</strong> Files, wikis and metadata you export or
          transfer move directly between your browser and OSF or the destination repository. They do not pass
          through BetterOSF&apos;s servers and are not stored by us at any size.
        </li>
        <li>
          <strong>Browser localStorage</strong> on your device for preferences, split-pane width, pins, recent
          items, and theme choices (also used when you are signed out; signed-in users sync bookmarks and
          key prefs to Neon).
        </li>
        <li>
          <strong>Pre-delete backups in your browser (IndexedDB)</strong>. When you delete files from OSF using
          BetterOSF, we first copy those files into your browser&apos;s local storage so you can restore a copy
          if the deletion was a mistake — OSF itself has no trash. These backups contain the actual contents of
          the files you deleted. They stay on your device: they are never uploaded to our servers, and they are
          deliberately kept outside the preferences that signed-in users sync to the database. We keep at most
          20 backups or 500&nbsp;MB, deleting the oldest first, and your browser may also clear them on its own.
          You can view and delete them at any time from the Backups panel, or by clearing this site&apos;s data.
        </li>
      </ul>

      <h2>What we don&apos;t store</h2>
      <ul>
        <li>No analytics service. No third-party telemetry.</li>
        <li>
          <strong>On our servers</strong> we don&apos;t cache file contents; previews and downloads stream from
          OSF&apos;s storage. The one exception to file contents being stored anywhere is the pre-delete backup
          described above, which is held only in your own browser.
        </li>
        <li>OSF OAuth tokens are not written to the database.</li>
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
