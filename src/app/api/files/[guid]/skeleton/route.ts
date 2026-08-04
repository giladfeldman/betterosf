import { isValidGuid } from "@/lib/osf/guid";
import { collectFolderSkeleton } from "@/lib/osf/folder-skeleton";
import { osfErrorResponse } from "@/lib/osf/error-response";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(
  req: Request,
  { params }: { params: Promise<{ guid: string }> }
): Promise<Response> {
  const { guid } = await params;
  if (!isValidGuid(guid)) return new Response("Invalid GUID", { status: 400 });
  const { searchParams } = new URL(req.url);
  const kind = searchParams.get("kind") === "registration" ? "registration" : "node";

  try {
    const skeleton = await collectFolderSkeleton(guid, { kind });
    return Response.json({ skeleton }, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (e) {
    // Shared mapper — this route pioneered honest 401/429 handling; the logic
    // now lives in one place so every OSF-backed route behaves identically.
    const mapped = osfErrorResponse(e);
    if (mapped) return mapped;
    console.error(`[files/${guid}/skeleton] error:`, e);
    return new Response("Could not load this project's folder structure. Please try again later.", { status: 500 });
  }
}
