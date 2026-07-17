import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { getRecentLogs } from "@/lib/db/logs";

export async function GET(req: Request) {
  const gate = await requireAdmin();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const url = new URL(req.url);
  const format = url.searchParams.get("format") ?? "jsonl";
  const level = url.searchParams.get("level") ?? undefined;
  const type = url.searchParams.get("type") ?? undefined;
  const logs = await getRecentLogs({
    level: level && level !== "all" ? level : undefined,
    type: type && type !== "all" ? type : undefined,
    limit: 2000,
  });
  if (format === "json") {
    return NextResponse.json(logs);
  }
  const lines = logs.map((l) =>
    JSON.stringify({
      id: l.id,
      createdAt: l.createdAt,
      level: l.level,
      type: l.type,
      message: l.message,
      context: l.context,
      userId: l.userId,
    }),
  );
  return new NextResponse(lines.join("\n") + "\n", {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Content-Disposition": 'attachment; filename="betterosf-logs.jsonl"',
    },
  });
}
