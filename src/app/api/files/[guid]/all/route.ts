import { isValidGuid } from "@/lib/osf/guid";
import { fetchAllProjectEntries } from "@/lib/osf/files-recursive";
import { osfErrorResponse } from "@/lib/osf/error-response";

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
    const mapped = osfErrorResponse(e);
    if (mapped) return mapped;
    console.error(`[files/${guid}/all] error:`, e);
    return new Response("Could not load this project's files. Please try again later.", { status: 500 });
  }
}
