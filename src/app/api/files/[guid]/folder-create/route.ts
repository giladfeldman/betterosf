import { createOsfStorageFolder, writeErrorResponse, type UploadTarget } from "@/lib/osf/write";

export const runtime = "nodejs";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ guid: string }> }
): Promise<Response> {
  try {
    const { guid } = await params;
    const body = await req.json().catch(() => ({}));
    const target: UploadTarget = {
      guid,
      provider: String(body.provider ?? ""),
      path: String(body.path ?? "/"),
      listingUrl: String(body.listingUrl ?? ""),
      uploadUrl: String(body.uploadUrl ?? ""),
      newFolderUrl: String(body.newFolderUrl ?? ""),
    };
    const result = await createOsfStorageFolder(target, String(body.name ?? ""));
    return Response.json({ ok: true, folder: result }, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (e) {
    return writeErrorResponse(e);
  }
}
