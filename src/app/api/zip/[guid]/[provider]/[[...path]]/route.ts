import { selectToken } from "@/lib/osf/tokens";
import { isValidGuid } from "@/lib/osf/guid";
import { contentDisposition } from "@/lib/http/content-disposition";

const ALLOWED_PROVIDERS = new Set([
  "osfstorage", "googledrive", "dropbox", "github", "s3", "box",
  "figshare", "onedrive", "owncloud", "gitlab", "bitbucket",
]);

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ guid: string; provider: string; path?: string[] }> }
): Promise<Response> {
  const { guid, provider, path } = await params;

  if (!isValidGuid(guid)) {
    return new Response("Invalid GUID", { status: 400 });
  }
  if (!ALLOWED_PROVIDERS.has(provider)) {
    return new Response("Unknown provider", { status: 400 });
  }

  const cleanPath = (path ?? []).map(safeDecode).filter((seg) => seg.length > 0);
  const folderPath = cleanPath.length > 0 ? cleanPath.map(encodeURIComponent).join("/") + "/" : "";
  const wbUrl = `https://files.osf.io/v1/resources/${guid}/providers/${provider}/${folderPath}?zip=`;

  const upstream = await fetch(wbUrl, {
    headers: {
      Authorization: `Bearer ${await selectToken()}`,
    },
  });

  if (!upstream.ok) {
    console.warn(`[zip/${guid}/${provider}] Waterbutler returned ${upstream.status}`);
    return new Response(`Upstream returned ${upstream.status}`, { status: upstream.status });
  }

  const filename = cleanPath.length > 0 ? `${cleanPath[cleanPath.length - 1]}.zip` : `${guid}-${provider}.zip`;

  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": contentDisposition(filename),
      "Cache-Control": "private, no-store",
    },
  });
}
