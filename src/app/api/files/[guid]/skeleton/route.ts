import { isValidGuid } from "@/lib/osf/guid";
import { collectFolderSkeleton } from "@/lib/osf/folder-skeleton";
import { OsfError } from "@/lib/osf/types";

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
    if (e instanceof OsfError && e.code === "not_found") return new Response("Not found", { status: 404 });
    if (e instanceof OsfError && e.code === "rate_limited") return new Response("OSF rate limit exceeded", { status: 429, headers: { "Retry-After": "60" } });
    if (e instanceof OsfError && e.code === "unauthorized") return new Response("OSF session expired. Reconnect OSF.", { status: 401 });
    if (e instanceof OsfError && e.code === "forbidden") return new Response("OSF permission denied or session expired", { status: e.status });
    console.error(`[files/${guid}/skeleton] error:`, e);
    return new Response("Could not load this project's folder structure. Please try again later.", { status: 500 });
  }
}
