import { isValidGuid } from "@/lib/osf/guid";
import { fetchAllProjectEntries } from "@/lib/osf/files-recursive";
import { OsfError } from "@/lib/osf/types";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ guid: string }> }
): Promise<Response> {
  const { guid } = await params;
  if (!isValidGuid(guid)) return new Response("Invalid GUID", { status: 400 });

  try {
    const entries = await fetchAllProjectEntries(guid);
    return Response.json({ entries }, {
      headers: { "Cache-Control": "private, max-age=60" },
    });
  } catch (e) {
    if (e instanceof OsfError && e.code === "not_found") return new Response("Not found", { status: 404 });
    console.error(`[files/${guid}/all] error:`, e);
    return new Response("Could not load this project's files. Please try again later.", { status: 500 });
  }
}
