import { isValidGuid } from "@/lib/osf/guid";
import { collectFolderSkeleton } from "@/lib/osf/folder-skeleton";
import { OsfError } from "@/lib/osf/types";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ guid: string }> }
): Promise<Response> {
  const { guid } = await params;
  if (!isValidGuid(guid)) return new Response("Invalid GUID", { status: 400 });

  try {
    const skeleton = await collectFolderSkeleton(guid);
    return Response.json({ skeleton }, {
      headers: { "Cache-Control": "private, max-age=300, stale-while-revalidate=3600" },
    });
  } catch (e) {
    if (e instanceof OsfError && e.code === "not_found") return new Response("Not found", { status: 404 });
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(msg, { status: 500 });
  }
}
