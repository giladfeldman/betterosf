import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAppUser } from "@/lib/db/require-user";
import {
  deleteBookmark,
  listBookmarksForUser,
  mergeBookmarks,
  upsertBookmark,
} from "@/lib/db/bookmarks";
import { logError, errorDetails } from "@/lib/logger";

const refSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  kind: z.enum(["project", "component", "file", "folder", "registration", "preprint", "user"]),
});

export async function GET() {
  const gate = await requireAppUser();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  try {
    const items = await listBookmarksForUser(gate.userId);
    return NextResponse.json({ items });
  } catch (err) {
    logError("db", "list bookmarks failed", { ...errorDetails(err) }, gate.userId);
    return NextResponse.json({ error: "Failed to load bookmarks" }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  const gate = await requireAppUser();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  try {
    const body = await req.json();
    if (Array.isArray(body?.items)) {
      const items = z.array(refSchema).parse(body.items);
      const merged = await mergeBookmarks(gate.userId, items);
      return NextResponse.json({ items: merged });
    }
    const ref = refSchema.parse(body);
    await upsertBookmark(gate.userId, ref);
    const items = await listBookmarksForUser(gate.userId);
    return NextResponse.json({ items });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid bookmark payload", issues: err.issues }, { status: 400 });
    }
    logError("db", "upsert bookmark failed", { ...errorDetails(err) }, gate.userId);
    return NextResponse.json({ error: "Failed to save bookmark" }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const gate = await requireAppUser();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  try {
    const url = new URL(req.url);
    const id = url.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
    await deleteBookmark(gate.userId, id);
    const items = await listBookmarksForUser(gate.userId);
    return NextResponse.json({ items });
  } catch (err) {
    logError("db", "delete bookmark failed", { ...errorDetails(err) }, gate.userId);
    return NextResponse.json({ error: "Failed to delete bookmark" }, { status: 500 });
  }
}
