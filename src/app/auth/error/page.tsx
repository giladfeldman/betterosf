import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Sign-in problem · BetterOSF",
  description: "What went wrong signing in with OSF, and what to do about it.",
};

/**
 * The sign-in error page.
 *
 * It replaces Auth.js's built-in one, which renders a black box reading "Server error —
 * There is a problem with the server configuration. Check the server logs for more
 * information." Three things are wrong with that for the person reading it: they cannot
 * check the server logs, "configuration" names the wrong cause for most of the errors that
 * land on it, and it offers nothing to do next.
 *
 * `Configuration` in particular is Auth.js's catch-all for any server-side failure during
 * the callback — including OSF issuing a token and then rejecting it, which has nothing to
 * do with configuration and usually clears by itself.
 *
 * What this page deliberately does NOT do is guess. It says what is known, says plainly
 * that the detail is server-side, and points at the two things that actually help: trying
 * again, and reporting it.
 */

type ErrorKind = "Configuration" | "AccessDenied" | "Verification" | "Default";

const EXPLANATIONS: Record<ErrorKind, { title: string; what: string; next: string[] }> = {
  Configuration: {
    title: "Sign-in did not complete",
    what:
      "You approved BetterOSF on osf.io, but the last step failed on our side. The most common cause is OSF issuing an access token and then not recognising it yet — OSF's API is eventually consistent, and a token can take a moment to become usable.",
    next: [
      "Try signing in again — this usually clears within a minute.",
      "If it keeps failing, OSF may be having problems: check status.cos.io.",
      "If it still fails after that, report it. The exact reason is in our server log, and we can read it.",
    ],
  },
  AccessDenied: {
    title: "Access was not granted",
    what:
      "The sign-in was declined — either you pressed Deny on osf.io, or your OSF account does not have permission to authorise this application.",
    next: [
      "Sign in again and choose Allow on the OSF approval screen.",
      "BetterOSF asks for read access to list and export your projects. It never deletes anything on OSF.",
    ],
  },
  Verification: {
    title: "That sign-in link has expired",
    what: "The link used to sign in is no longer valid.",
    next: ["Start again from the sign-in button."],
  },
  Default: {
    title: "Sign-in problem",
    what: "Something went wrong while signing in with OSF.",
    next: ["Try again.", "If it keeps happening, report it and we will look at the server log."],
  },
};

export default async function AuthErrorPage({
  searchParams,
}: {
  searchParams?: Promise<{ error?: string }>;
}) {
  const sp = (await searchParams) ?? {};
  const raw = sp.error ?? "Default";
  const kind: ErrorKind = raw in EXPLANATIONS ? (raw as ErrorKind) : "Default";
  const info = EXPLANATIONS[kind];

  return (
    <main className="mx-auto max-w-2xl px-4 py-16">
      <h1 className="text-2xl font-semibold">{info.title}</h1>
      <p className="mt-3 text-sm text-neutral-700 dark:text-neutral-300">{info.what}</p>

      <h2 className="mt-6 text-sm font-semibold">What to do</h2>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-neutral-700 dark:text-neutral-300">
        {info.next.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>

      <div className="mt-6 flex flex-wrap gap-3">
        <Link
          href="/transition"
          className="rounded bg-neutral-900 px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-neutral-900"
        >
          Try signing in again
        </Link>
        <Link href="/" className="rounded border border-neutral-400 px-4 py-2 text-sm dark:border-neutral-600">
          Back to BetterOSF
        </Link>
        <Link href="/feedback" className="rounded border border-neutral-400 px-4 py-2 text-sm dark:border-neutral-600">
          Report this
        </Link>
      </div>

      <p className="mt-8 text-xs text-neutral-600 dark:text-neutral-400">
        Nothing on OSF was changed, and nothing was deleted. BetterOSF never writes to OSF during
        sign-in.
      </p>

      <details className="mt-4">
        <summary className="cursor-pointer text-xs text-neutral-600 dark:text-neutral-400">
          Technical details
        </summary>
        <pre className="mt-2 overflow-x-auto rounded bg-neutral-100 p-2 text-xs dark:bg-neutral-900">
          {`error: ${raw}`}
        </pre>
        <p className="mt-2 text-xs text-neutral-600 dark:text-neutral-400">
          {/*
            Said outright rather than implied: Auth.js reports several unrelated
            server-side failures as "Configuration", so the code above is a category, not a
            diagnosis. The real cause is in the server log, which this page cannot read.
          */}
          Auth.js reports several different server-side failures under the same code, so this is a
          category rather than a diagnosis. The specific reason is recorded in our server log — quote
          the time you saw this and we can find it.
        </p>
      </details>
    </main>
  );
}
