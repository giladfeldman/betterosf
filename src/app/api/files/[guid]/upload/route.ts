import { uploadFileToOsfStorage, writeErrorResponse, type UploadTarget } from "@/lib/osf/write";

export const runtime = "nodejs";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ guid: string }> }
): Promise<Response> {
  try {
    const { guid } = await params;
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return Response.json({ error: "Missing upload file", code: "invalid" }, { status: 400 });
    }
    const target: UploadTarget = {
      guid,
      provider: String(form.get("provider") ?? ""),
      path: String(form.get("path") ?? "/"),
      listingUrl: String(form.get("listingUrl") ?? ""),
      uploadUrl: String(form.get("uploadUrl") ?? ""),
      newFolderUrl: String(form.get("newFolderUrl") ?? ""),
    };
    const overwrite = String(form.get("overwrite") ?? "") === "true";
    const result = await uploadFileToOsfStorage(target, file, { overwrite });
    return Response.json({ ok: true, file: result }, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (e) {
    return writeErrorResponse(e);
  }
}
