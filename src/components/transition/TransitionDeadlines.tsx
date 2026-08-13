"use client";

import { useEffect, useState } from "react";
import {
  TRANSITION_DEADLINES,
  deadlineStatus,
  describeDeadline,
} from "@/lib/transition/deadlines";

/**
 * The announced timeline, with an exact day count.
 *
 * Client-side so the count is right for the reader's actual today — a server-rendered
 * countdown would be wrong for as long as the page stayed cached. Renders the dates
 * immediately and fills in the counts after mount, so nothing depends on hydration to be
 * readable.
 *
 * The attribution line is not decoration. These are COS's dates, they can change, and a
 * countdown presented as ours would be lending false certainty to someone else's plan.
 */
export function TransitionDeadlines() {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    // Re-check hourly so a long-lived tab does not sit on a stale count.
    const t = setInterval(() => setNow(new Date()), 3_600_000);
    return () => clearInterval(t);
  }, []);

  return (
    <section aria-labelledby="transition-timeline">
      <h2 id="transition-timeline" className="text-lg font-semibold">
        What is changing on OSF
      </h2>

      <ul className="mt-4 grid gap-3 sm:grid-cols-2">
        {TRANSITION_DEADLINES.map((d) => {
          const status = now ? deadlineStatus(d.date, now) : null;
          const passed = status === "passed";
          return (
            <li
              key={d.id}
              className={`rounded border p-4 ${
                passed
                  ? "border-neutral-300 bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900"
                  : "border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950"
              }`}
            >
              <div className="flex flex-wrap items-baseline gap-x-2">
                <time dateTime={d.date} className="text-sm font-semibold">
                  {d.date}
                </time>
                {now ? (
                  <span className="text-xs text-neutral-600 dark:text-neutral-400">
                    {describeDeadline(d.date, now)}
                  </span>
                ) : null}
              </div>
              <p className="mt-1 text-sm font-medium">{d.headline}</p>
              <p className="mt-1 text-sm text-neutral-700 dark:text-neutral-300">{d.detail}</p>
            </li>
          );
        })}
      </ul>

      <p className="mt-3 text-xs text-neutral-600 dark:text-neutral-400">
        Dates reported from the Center for Open Science’s public announcements — see{" "}
        <a
          href="https://www.cos.io/osf-changes"
          className="underline"
          target="_blank"
          rel="noopener noreferrer"
        >
          cos.io/osf-changes
        </a>{" "}
        and{" "}
        <a
          href="https://help.osf.io/article/727-osf-projects-transition"
          className="underline"
          target="_blank"
          rel="noopener noreferrer"
        >
          the transition guide
        </a>
        . They may change, and they are not advice. Public projects stay online read-only; COS has
        said it anticipates removing private projects later, with 12 months’ notice. Registrations
        and preprints are not affected.
      </p>
    </section>
  );
}
