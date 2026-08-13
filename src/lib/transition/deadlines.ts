/**
 * The OSF Projects transition timeline, as announced publicly by COS on 2026-08-13.
 *
 * Sources:
 *   https://www.cos.io/osf-changes
 *   https://help.osf.io/article/727-osf-projects-transition
 *   https://help.osf.io/article/725-faqs
 *
 * These are REPORTED, not advised. COS can change them, and the UI says so — a countdown
 * that reads as authoritative would be us lending false certainty to someone else's plan.
 *
 * Pure and dependency-free so the date arithmetic is testable without rendering anything.
 */

export type Deadline = {
  id: string;
  /** ISO date (UTC) the change takes effect. */
  date: string;
  headline: string;
  detail: string;
};

export const TRANSITION_DEADLINES: Deadline[] = [
  {
    id: "no-new-projects",
    date: "2026-11-16",
    headline: "No new projects or components",
    detail:
      "You can still edit everything you already have, but you cannot create a new project, or a new component inside an existing one.",
  },
  {
    id: "read-only",
    date: "2027-02-19",
    headline: "Everything becomes read-only",
    detail:
      "All projects, public and private, stop accepting changes: no file uploads, no metadata edits, no contributor changes, no new view-only links. Many OSF API write functions are deprecated.",
  },
];

/**
 * Whole days from `now` until `date` (UTC midnight to UTC midnight).
 *
 * Negative once the date has passed. Deliberately not rounded to "about a month" — a
 * researcher planning around a deadline needs the number, not a vibe.
 */
export function daysUntil(date: string, now: Date): number {
  const target = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(target)) throw new Error(`Not an ISO date: ${date}`);
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((target - today) / 86_400_000);
}

export type DeadlineStatus = "upcoming" | "today" | "passed";

export function deadlineStatus(date: string, now: Date): DeadlineStatus {
  const d = daysUntil(date, now);
  if (d > 0) return "upcoming";
  if (d === 0) return "today";
  return "passed";
}

/**
 * The next deadline that has not yet passed, or null once they all have.
 *
 * Returns a deadline falling TODAY — it has not passed, and it is the most urgent thing
 * a user could be told.
 */
export function nextDeadline(now: Date, deadlines: Deadline[] = TRANSITION_DEADLINES): Deadline | null {
  return (
    [...deadlines]
      .sort((a, b) => a.date.localeCompare(b.date))
      .find((d) => deadlineStatus(d.date, now) !== "passed") ?? null
  );
}

/** "in 95 days" / "today" / "passed" — the phrase shown next to a date. */
export function describeDeadline(date: string, now: Date): string {
  const d = daysUntil(date, now);
  if (d === 0) return "today";
  if (d < 0) return d === -1 ? "1 day ago" : `${Math.abs(d)} days ago`;
  return d === 1 ? "in 1 day" : `in ${d} days`;
}
