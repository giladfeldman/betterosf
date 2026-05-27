import "server-only";
import { selectToken } from "@/lib/osf/tokens";

export type ZipFetchResult =
  | { status: "ok"; body: ReadableStream<Uint8Array> }
  | { status: "error"; code: number; message: string };

export async function fetchProviderZip(guid: string, provider: string, folderPath = "/"): Promise<ZipFetchResult> {
  const normalized = folderPath === "/" ? "" : folderPath.replace(/^\/+|\/+$/g, "").split("/").map(encodeURIComponent).join("/") + "/";
  const url = `https://files.osf.io/v1/resources/${guid}/providers/${provider}/${normalized}?zip=`;
  try {
    const token = await selectToken();
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      return { status: "error", code: res.status, message: `Provider ${provider} on node ${guid}: HTTP ${res.status}` };
    }
    if (!res.body) {
      return { status: "error", code: 500, message: `Provider ${provider} on node ${guid}: empty body` };
    }
    return { status: "ok", body: res.body };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { status: "error", code: 0, message: `Provider ${provider} on node ${guid}: ${msg}` };
  }
}
