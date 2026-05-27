import archiver from "archiver";
import { Readable } from "node:stream";
import { z } from "zod";
import { isValidGuid } from "@/lib/osf/guid";
import { selectToken } from "@/lib/osf/tokens";
import { fetchProviderZip } from "@/lib/waterbutler/zip";

export const runtime = "nodejs";
export const maxDuration = 600;

const ALLOWED_PROVIDERS = new Set([
  "osfstorage", "googledrive", "dropbox", "github", "s3", "box",
  "figshare", "onedrive", "owncloud", "gitlab", "bitbucket",
]);

const ALLOWED_DOWNLOAD_HOSTS = new Set([
  "osf.io",
  "files.osf.io",
  "files.us.osf.io",
  "files.de-1.osf.io",
  "files.ca-1.osf.io",
  "api.osf.io",
]);

const itemSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("file"),
    guid: z.string().refine(isValidGuid),
    provider: z.string(),
    path: z.string().min(1),
    name: z.string().min(1),
    downloadUrl: z.string().url(),
  }),
  z.object({
    kind: z.literal("folder"),
    guid: z.string().refine(isValidGuid),
    provider: z.string(),
    path: z.string().min(1),
    name: z.string().min(1),
  }),
]);

const bodySchema = z.object({
  items: z.array(itemSchema).min(1).max(200),
});

function safeZipPart(s: string): string {
  return s.replace(/[\\/:*?"<>|]/g, "_").replace(/\s+/g, " ").trim().slice(0, 120) || "untitled";
}

function safeZipPath(guid: string, provider: string, path: string): string {
  const parts = path.split("/").filter(Boolean).map(safeZipPart);
  return [safeZipPart(guid), safeZipPart(provider), ...parts].join("/");
}

function validateProvider(provider: string): boolean {
  return ALLOWED_PROVIDERS.has(provider);
}

function validateDownloadUrl(downloadUrl: string): boolean {
  try {
    const url = new URL(downloadUrl);
    return url.protocol === "https:" && ALLOWED_DOWNLOAD_HOSTS.has(url.host);
  } catch {
    return false;
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ guid: string }> }
): Promise<Response> {
  const { guid } = await params;
  if (!isValidGuid(guid)) return new Response("Invalid GUID", { status: 400 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Invalid selection payload" }, { status: 400 });
  }

  for (const item of parsed.data.items) {
    if (!validateProvider(item.provider)) {
      return Response.json({ error: `Unknown provider: ${item.provider}` }, { status: 400 });
    }
    if (item.kind === "file" && !validateDownloadUrl(item.downloadUrl)) {
      return Response.json({ error: "Invalid file download URL" }, { status: 400 });
    }
  }

  const archive = archiver("zip", { zlib: { level: 0 } });
  const errors: string[] = [];

  (async () => {
    let token = "";
    try { token = await selectToken(); } catch { /* anonymous */ }

    try {
      for (const item of parsed.data.items) {
        if (item.kind === "folder") {
          const result = await fetchProviderZip(item.guid, item.provider, item.path);
          if (result.status === "error") {
            errors.push(`[${item.guid}/${item.provider}${item.path}] ${result.message}`);
            continue;
          }
          const nodeStream = Readable.fromWeb(result.body as unknown as import("node:stream/web").ReadableStream<Uint8Array>);
          const folderName = item.path === "/" ? `${item.provider}.zip` : `${safeZipPart(item.name)}.zip`;
          archive.append(nodeStream, { name: `${safeZipPart(item.guid)}/${safeZipPart(item.provider)}/${folderName}` });
          continue;
        }

        let upstream = await fetch(item.downloadUrl, {
          headers: token
            ? { Authorization: `Bearer ${token}`, Accept: "application/octet-stream, */*" }
            : { Accept: "application/octet-stream, */*" },
          redirect: "follow",
        });
        if (token && (upstream.status === 401 || upstream.status === 403)) {
          upstream = await fetch(item.downloadUrl, {
            headers: { Accept: "application/octet-stream, */*" },
            redirect: "follow",
          });
        }
        if (!upstream.ok || !upstream.body) {
          errors.push(`[${item.guid}/${item.provider}${item.path}] HTTP ${upstream.status}`);
          continue;
        }
        const nodeStream = Readable.fromWeb(upstream.body as unknown as import("node:stream/web").ReadableStream<Uint8Array>);
        archive.append(nodeStream, { name: safeZipPath(item.guid, item.provider, item.path) });
      }

      if (errors.length > 0) {
        archive.append(
          `BetterOSF selected-items ZIP - partial failures\nGenerated at ${new Date().toISOString()}\n\n${errors.map((e) => `- ${e}`).join("\n")}\n`,
          { name: "_BETTEROSF_SELECTION_ERRORS.txt" }
        );
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      archive.append(`Fatal error while assembling selected-items ZIP: ${msg}\n`, { name: "_BETTEROSF_FATAL.txt" });
    } finally {
      await archive.finalize();
    }
  })().catch(() => { /* archive writes its own error entry */ });

  const webStream = Readable.toWeb(archive) as unknown as ReadableStream<Uint8Array>;
  return new Response(webStream, {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="betterosf-selection-${guid}.zip"`,
      "Cache-Control": "private, no-store",
    },
  });
}
