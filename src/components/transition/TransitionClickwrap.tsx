"use client";

import { useState } from "react";
import Link from "next/link";
import { TERMS_VERSION, TRANSITION_DIALOG_CLAUSE_IDS, clausesByIds } from "@/lib/terms";
import { readErrorResponse } from "@/lib/http/read-error";

/**
 * The one-time gate on entering the transition toolkit.
 *
 * Clauses are rendered INLINE, never behind a link — a clickwrap the user cannot miss by
 * not clicking through. The ids of what was actually rendered are posted back, and the
 * server rejects the submission if any required clause is missing, so a partial render
 * can never produce a consent record.
 */
export function TransitionClickwrap({ onConsented }: { onConsented: () => void }) {
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Throws on an unknown id rather than silently rendering short. If this ever throws,
  // the terms and the dialog have drifted and the gate must not open.
  const clauses = clausesByIds(TRANSITION_DIALOG_CLAUSE_IDS);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/transition/consent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          termsVersion: TERMS_VERSION,
          clauseIds: clauses.map((c) => c.id),
        }),
      });
      if (!res.ok) {
        const e = await readErrorResponse(res);
        setError(e.message);
        return;
      }
      onConsented();
    } catch {
      setError("Could not reach BetterOSF. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-semibold">Before you start</h1>
      <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
        These terms apply whenever you use BetterOSF to export a project or transfer one to another
        repository. Please read them — they are short, and they describe real limits on what this
        tool can promise.
      </p>

      <ol className="mt-6 space-y-5 rounded border border-neutral-300 bg-neutral-50 p-5 dark:border-neutral-700 dark:bg-neutral-900">
        {clauses.map((clause) => (
          <li key={clause.id}>
            <h2 className="text-sm font-semibold">{clause.heading}</h2>
            <p className="mt-1 text-sm leading-relaxed text-neutral-700 dark:text-neutral-300">
              {clause.body}
            </p>
          </li>
        ))}
      </ol>

      <p className="mt-4 text-sm text-neutral-600 dark:text-neutral-400">
        These are an extract. The{" "}
        <Link href="/terms" className="underline" target="_blank" rel="noopener noreferrer">
          full terms
        </Link>{" "}
        (version {TERMS_VERSION}) apply in full.
      </p>

      <label className="mt-6 flex items-start gap-3 text-sm">
        <input
          type="checkbox"
          checked={agreed}
          onChange={(e) => setAgreed(e.target.checked)}
          className="mt-1 h-4 w-4 shrink-0"
        />
        <span>
          I have read and agree to these terms. I understand BetterOSF gives me no warranty that an
          export or transfer is complete or correct, and that verifying my own data is my
          responsibility.
        </span>
      </label>

      {error ? (
        <p role="alert" className="mt-4 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
          {error}
        </p>
      ) : null}

      <button
        type="button"
        disabled={!agreed || busy}
        onClick={submit}
        className="mt-6 rounded bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-neutral-900"
      >
        {busy ? "Recording…" : "Agree and continue"}
      </button>
    </div>
  );
}
