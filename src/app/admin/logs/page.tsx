import { redirect } from "next/navigation";
import Link from "next/link";
import type { Route } from "next";
import { auth } from "@/auth";
import { isAdminSession } from "@/lib/admin";
import { getRecentLogs } from "@/lib/db/logs";

export const metadata = { title: "Admin logs — BetterOSF" };

export default async function AdminLogsPage({
  searchParams,
}: {
  searchParams?: Promise<{ level?: string; type?: string; q?: string; limit?: string }>;
}) {
  const session = await auth();
  if (!session) redirect("/login");
  if (!(await isAdminSession())) redirect("/");
  const sp = (await searchParams) ?? {};
  const level = sp.level && sp.level !== "all" ? sp.level : undefined;
  const type = sp.type && sp.type !== "all" ? sp.type : undefined;
  const q = (sp.q ?? "").trim().toLowerCase();
  const limit = Math.min(Math.max(parseInt(sp.limit ?? "200", 10) || 200, 10), 2000);
  const raw = await getRecentLogs({ level, type, limit: q ? Math.max(limit * 5, 500) : limit });
  const logs = q
    ? raw
        .filter((l) => {
          const msg = l.message.toLowerCase();
          const ctx = JSON.stringify(l.context).toLowerCase();
          return msg.includes(q) || ctx.includes(q);
        })
        .slice(0, limit)
    : raw;

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">System logs</h1>
        <Link href={"/api/admin/logs/export?format=jsonl" as Route} className="text-sm text-blue-600 hover:underline">
          Export JSONL
        </Link>
      </div>
      <p className="text-sm text-neutral-600 dark:text-neutral-400">
        Durable app logs (Neon EU). Set <code className="text-xs">ADMIN_OSF_USER_IDS</code> to your OSF user guid(s).
      </p>
      <form className="flex flex-wrap gap-2 text-sm" method="get">
        <select name="level" defaultValue={sp.level ?? "all"} className="rounded border px-2 py-1 bg-white dark:bg-neutral-900">
          {["all", "error", "warn", "info", "debug"].map((l) => (
            <option key={l} value={l}>{l}</option>
          ))}
        </select>
        <select name="type" defaultValue={sp.type ?? "all"} className="rounded border px-2 py-1 bg-white dark:bg-neutral-900">
          {/* Must list every LogType in src/lib/logger.ts — a type missing here is a log
              nobody can filter for, which is most of the value of writing it. */}
          {["all", "auth", "osf", "upload", "delete", "rename", "transition", "email", "db", "admin", "request", "uncaught", "other"].map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <input
          name="q"
          defaultValue={sp.q ?? ""}
          placeholder="Search message/context"
          className="min-w-[12rem] flex-1 rounded border px-2 py-1 bg-white dark:bg-neutral-900"
        />
        <button type="submit" className="rounded border px-3 py-1 hover:bg-neutral-100 dark:hover:bg-neutral-800">
          Filter
        </button>
      </form>
      <div className="overflow-x-auto rounded border border-neutral-200 dark:border-neutral-800">
        <table className="w-full text-left text-sm">
          <thead className="bg-neutral-50 dark:bg-neutral-900">
            <tr>
              <th className="px-3 py-2">When</th>
              <th className="px-3 py-2">Level</th>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2">Message</th>
            </tr>
          </thead>
          <tbody>
            {logs.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-neutral-500">No logs yet.</td>
              </tr>
            ) : (
              logs.map((l) => (
                <tr key={l.id} className="border-t border-neutral-100 dark:border-neutral-800 align-top">
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-neutral-500">
                    {l.createdAt?.toISOString?.() ?? String(l.createdAt)}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{l.level}</td>
                  <td className="px-3 py-2 font-mono text-xs">{l.type}</td>
                  <td className="px-3 py-2">
                    <div>{l.message}</div>
                    {l.context && Object.keys(l.context).length > 0 && (
                      <pre className="mt-1 max-h-24 overflow-auto text-[10px] text-neutral-500">
                        {JSON.stringify(l.context)}
                      </pre>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
