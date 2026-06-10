export const metadata = { title: "Bookmarklet - BetterOSF" };

// osf.io (and *.osf.io) <-> betterosf.vercel.app, preserving path + query + hash.
const BOOKMARKLET =
  "javascript:(function(){var h=location.hostname,p=location.pathname+location.search+location.hash;" +
  "if(/(^|\\.)osf\\.io$/.test(h)){location.href='https://betterosf.vercel.app'+p;}" +
  "else if(h==='betterosf.vercel.app'){location.href='https://osf.io'+p;}" +
  "else{alert('This bookmarklet only works on OSF or BetterOSF pages.');}})();";

// Static, escaped anchor. onclick returns false so clicking it ON this page
// (where location is betterosf) doesn't fire the redirect; users DRAG it.
const draggableLinkHtml =
  `<a href="${BOOKMARKLET}" onclick="return false" ` +
  `class="inline-block rounded border border-blue-400 bg-blue-50 px-4 py-2 font-semibold text-blue-700 ` +
  `dark:border-blue-700 dark:bg-blue-950 dark:text-blue-300" ` +
  `title="Drag me to your bookmarks bar">↔ OSF ⇄ BetterOSF</a>`;

export default function BookmarkletPage() {
  return (
    <article className="max-w-3xl space-y-5 text-neutral-700 dark:text-neutral-300 leading-relaxed">
      <h1 className="text-2xl font-semibold text-neutral-900 dark:text-neutral-100">Bookmarklet</h1>
      <p>
        Drag the button below to your bookmarks bar. Then, on any{" "}
        <a href="https://osf.io" className="text-blue-600 hover:underline">osf.io</a> page, click it to jump to
        the same page on BetterOSF — and on any BetterOSF page, click it to jump back to OSF. Your current
        path, query, and anchor are preserved.
      </p>

      <div
        className="rounded border border-dashed border-neutral-300 p-6 text-center dark:border-neutral-700"
        dangerouslySetInnerHTML={{ __html: draggableLinkHtml }}
      />
      <p className="text-sm text-neutral-500">
        Tip: if your browser won&apos;t let you drag it, create a new bookmark manually and paste the code
        below as the URL/location.
      </p>

      <div>
        <h2 className="mb-2 text-lg font-semibold text-neutral-900 dark:text-neutral-100">Bookmarklet code</h2>
        <pre className="overflow-x-auto rounded border border-neutral-200 bg-neutral-50 p-3 text-xs dark:border-neutral-800 dark:bg-neutral-900">
          <code>{BOOKMARKLET}</code>
        </pre>
      </div>

      <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">How it works</h2>
      <ul className="list-inside list-disc space-y-1">
        <li>On <code>osf.io</code> (or any <code>*.osf.io</code> subdomain) → opens <code>betterosf.vercel.app</code> with the same path.</li>
        <li>On <code>betterosf.vercel.app</code> → opens <code>osf.io</code> with the same path.</li>
        <li>Anywhere else → shows a short notice and does nothing.</li>
      </ul>
    </article>
  );
}
