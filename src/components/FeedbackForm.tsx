"use client";

import { useEffect, useState } from "react";
import { FEEDBACK_KINDS, MAX_MESSAGE_LEN } from "@/lib/feedback/validate";

const KIND_LABELS: Record<string, string> = {
  bug: "Something is broken",
  idea: "I have an idea",
  question: "I have a question",
};

export function FeedbackForm() {
  const [kind, setKind] = useState<string>("bug");
  const [message, setMessage] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [pageUrl, setPageUrl] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [reportId, setReportId] = useState<string | null>(null);

  // Prefill with the page the user came from — the field they are least likely
  // to fill in themselves and the one most likely to make the report actionable.
  useEffect(() => {
    const from = document.referrer;
    if (from && from.startsWith(window.location.origin)) {
      setPageUrl(from.slice(window.location.origin.length) || "/");
    }
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState("sending");
    setError(null);
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, message, contactEmail, pageUrl }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; id?: string };
      if (!res.ok) {
        setError(data.error ?? `Submission failed (HTTP ${res.status}).`);
        setState("error");
        return;
      }
      setReportId(data.id ?? null);
      setState("sent");
    } catch {
      setError("Network error — your report wasn't sent. Please try again, or email betterosf@scimeto.app.");
      setState("error");
    }
  }

  if (state === "sent") {
    return (
      <div className="rounded border border-green-300 bg-green-50 p-4 dark:border-green-800 dark:bg-green-950/40">
        <h2 className="mb-1 text-lg font-semibold">Thank you — your report was received.</h2>
        <p className="text-sm text-neutral-700 dark:text-neutral-300">
          It has been saved and sent to the maintainer.
          {contactEmail.trim()
            ? " If a reply is needed, you'll hear back at the address you gave."
            : " You didn't leave an email address, so we can't reply — that's fine, the report still helps."}
        </p>
        {reportId && (
          <p className="mt-2 font-mono text-xs text-neutral-500">Reference: {reportId}</p>
        )}
        <button
          type="button"
          onClick={() => {
            setState("idle");
            setMessage("");
            setReportId(null);
          }}
          className="mt-3 rounded border px-3 py-1 text-sm hover:bg-white dark:hover:bg-neutral-900"
        >
          Send another
        </button>
      </div>
    );
  }

  const remaining = MAX_MESSAGE_LEN - message.length;

  return (
    <form onSubmit={submit} className="space-y-4">
      <fieldset>
        <legend className="mb-2 text-sm font-medium">What kind of feedback is this?</legend>
        <div className="flex flex-wrap gap-2">
          {FEEDBACK_KINDS.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              aria-pressed={kind === k}
              className={`rounded border px-3 py-1 text-sm ${
                kind === k
                  ? "border-blue-500 bg-blue-600 text-white"
                  : "border-neutral-300 hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
              }`}
            >
              {KIND_LABELS[k]}
            </button>
          ))}
        </div>
      </fieldset>

      <div>
        <label htmlFor="fb-message" className="mb-1 block text-sm font-medium">
          What happened?
        </label>
        <textarea
          id="fb-message"
          required
          rows={7}
          maxLength={MAX_MESSAGE_LEN}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="What did you expect, and what happened instead? If it involves a specific OSF project or file, paste the link."
          className="w-full rounded border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-950"
        />
        <p className="mt-1 text-xs text-neutral-500">{remaining} characters left</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="fb-page" className="mb-1 block text-sm font-medium">
            Page it happened on <span className="font-normal text-neutral-500">(optional)</span>
          </label>
          <input
            id="fb-page"
            type="text"
            value={pageUrl}
            onChange={(e) => setPageUrl(e.target.value)}
            placeholder="/3kmr9/files/..."
            className="w-full rounded border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-950"
          />
        </div>
        <div>
          <label htmlFor="fb-email" className="mb-1 block text-sm font-medium">
            Your email <span className="font-normal text-neutral-500">(optional)</span>
          </label>
          <input
            id="fb-email"
            type="email"
            value={contactEmail}
            onChange={(e) => setContactEmail(e.target.value)}
            placeholder="you@university.edu"
            className="w-full rounded border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-950"
          />
          <p className="mt-1 text-xs text-neutral-500">Only used to reply about this report.</p>
        </div>
      </div>

      {error && (
        <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={state === "sending" || message.trim().length < 5}
        className="rounded border border-blue-500 bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:border-neutral-300 disabled:bg-neutral-200 disabled:text-neutral-500 dark:disabled:border-neutral-700 dark:disabled:bg-neutral-800"
      >
        {state === "sending" ? "Sending…" : "Send report"}
      </button>
    </form>
  );
}
