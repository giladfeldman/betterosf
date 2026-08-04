import { isValidGuid } from "@/lib/osf/guid";
import { getFolderContents } from "@/lib/osf/files";
import { osfErrorResponse } from "@/lib/osf/error-response";

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
    // Map known OSF conditions to honest status codes. In particular a 401
    // (expired token) must NOT become a 500 "try again later" — the tree renders
    // this message verbatim, and retrying can never renew a token.
    const mapped = osfErrorResponse(e);
    if (mapped) return mapped;
    console.error(`[files/${guid}/folder] error:`, e);
    return new Response("Could not load this folder. Please try again later.", { status: 500 });
  }
}
