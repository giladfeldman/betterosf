import { isValidGuid } from "@/lib/osf/guid";
import { getFolderContents } from "@/lib/osf/files";
import { OsfError } from "@/lib/osf/types";

export const runtime = "nodejs";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ guid: string }> }
): Promise<Response> {
  const { guid } = await params;
  if (!isValidGuid(guid)) return new Response("Invalid GUID", { status: 400 });
  const url = new URL(req.url);
  const listingUrl = url.searchParams.get("listingUrl");
  if (!listingUrl) return new Response("Missing listingUrl", { status: 400 });
  if (!listingUrl.startsWith("https://api.osf.io/v2/")) return new Response("Invalid listingUrl", { status: 400 });

  const fresh = url.searchParams.get("fresh") === "1";
  try {
    const entries = await getFolderContents(listingUrl, guid, { fresh });
    return Response.json({ entries }, {
      headers: { "Cache-Control": fresh ? "private, no-store" : "private, max-age=60" },
    });
  } catch (e) {
    if (e instanceof OsfError && e.code === "not_found") return new Response("Not found", { status: 404 });
    console.error(`[files/${guid}/folder] error:`, e);
    return new Response("Could not load this folder. Please try again later.", { status: 500 });
  }
}
