import { redirect } from "next/navigation";
import Link from "next/link";
import type { Route } from "next";
import { auth } from "@/auth";
import { isAdminSession } from "@/lib/admin";
import { listBugReports, countBugReportsByStatus } from "@/lib/db/bug-reports";
import { BugReportRow } from "@/components/admin/BugReportRow";

export const metadata = { title: "Feedback inbox — BetterOSF" };
export const dynamic = "force-dynamic";

const STATUSES = ["all", "new", "triaged", "resolved"] as const;

export default async function AdminFeedbackPage({
  searchParams,
}: {
  searchParams?: Promise<{ status?: string }>;
}) {
  const session = await auth();
  if (!session) redirect("/login");
  if (!(await isAdminSession())) redirect("/");

  const sp = (await searchParams) ?? {};
  const status = STATUSES.includes((sp.status ?? "new") as (typeof STATUSES)[number])
    ? (sp.status ?? "new")
    : "new";

  const [reports, counts] = await Promise.all([
    listBugReports({ status, limit: 200 }),
    countBugReportsByStatus(),
  ]);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Feedback inbox</h1>
        <Link href="/admin/logs" className="text-sm text-blue-600 hover:underline">
          System logs →
        </Link>
      </div>

      <p className="text-sm text-neutral-600 dark:text-neutral-400">
        User-submitted bug reports, ideas, and questions. {total} total
        {counts.new ? ` · ${counts.new} new` : ""}.
      </p>

      <div className="flex flex-wrap gap-2 text-sm">
        {STATUSES.map((s) => (
          <Link
            key={s}
            href={(s === "new" ? "/admin/feedback" : `/admin/feedback?status=${s}`) as Route}
            className={`rounded border px-3 py-1 ${
              s === status
                ? "border-blue-500 bg-blue-600 text-white"
                : "border-neutral-300 hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
            }`}
          >
            {s}
            {s !== "all" && counts[s] ? <span className="ml-1 opacity-75">{counts[s]}</span> : null}
          </Link>
        ))}
      </div>

      {reports.length === 0 ? (
        <p className="rounded border border-dashed border-neutral-300 px-4 py-10 text-center text-sm text-neutral-500 dark:border-neutral-700">
          No {status === "all" ? "" : status} reports.
        </p>
      ) : (
        <ul className="space-y-3">
          {reports.map((r) => (
            <BugReportRow
              key={r.id}
              report={{
                id: r.id,
                kind: r.kind,
                message: r.message,
                contactEmail: r.contactEmail,
                pageUrl: r.pageUrl,
                appVersion: r.appVersion,
                osfUserId: r.osfUserId,
                status: r.status,
                createdAt: r.createdAt.toISOString(),
              }}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
