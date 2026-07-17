import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAppUser } from "@/lib/db/require-user";
import { getUserPrefs, patchUserPrefs, setUserPrefs } from "@/lib/db/prefs-store";
import { logError, errorDetails } from "@/lib/logger";

const prefsSchema = z.record(z.unknown());

export async function GET() {
  const gate = await requireAppUser();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  try {
    const prefs = await getUserPrefs(gate.userId);
    return NextResponse.json({ prefs });
  } catch (err) {
    logError("db", "get prefs failed", { ...errorDetails(err) }, gate.userId);
    return NextResponse.json({ error: "Failed to load preferences" }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  const gate = await requireAppUser();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  try {
    const body = await req.json();
    const prefs = prefsSchema.parse(body?.prefs ?? body);
    const merge = body?.merge !== false;
    const next = merge ? await patchUserPrefs(gate.userId, prefs) : await setUserPrefs(gate.userId, prefs);
    return NextResponse.json({ prefs: next });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid prefs payload", issues: err.issues }, { status: 400 });
    }
    logError("db", "save prefs failed", { ...errorDetails(err) }, gate.userId);
    return NextResponse.json({ error: "Failed to save preferences" }, { status: 500 });
  }
}
