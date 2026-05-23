import archiver from "archiver";
import { Readable } from "node:stream";
import { isValidGuid } from "@/lib/osf/guid";
import { OsfError } from "@/lib/osf/types";
import { collectNodeTree, type TreeNode } from "@/lib/osf/tree";
import { getProviderRoots } from "@/lib/osf/files";
import { fetchProviderZip } from "@/lib/waterbutler/zip";

export const runtime = "nodejs";
export const maxDuration = 600; // 10 minutes

function safeFolderName(s: string): string {
  // Strip path separators and trim
  return s.replace(/[\\/]/g, "_").slice(0, 80).trim() || "untitled";
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ guid: string }> }
): Promise<Response> {
  const { guid } = await params;
  if (!isValidGuid(guid)) return new Response("Invalid GUID", { status: 400 });

  let tree: TreeNode[];
  try {
    tree = await collectNodeTree(guid);
  } catch (e) {
    if (e instanceof OsfError && e.code === "not_found") {
      return new Response("Project not found", { status: 404 });
    }
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(`Failed to walk node tree: ${msg}`, { status: 500 });
  }

  const rootTitle = safeFolderName(tree[0]?.title ?? guid);
  const archive = archiver("zip", { zlib: { level: 0 } }); // pre-compressed content
  const errors: string[] = [];

  // Kick off the work in the background; archiver.finalize() will close the stream when done.
  (async () => {
    try {
      for (const node of tree) {
        const folder = node.guid === guid
          ? rootTitle
          : `${rootTitle}/${node.linked ? "linked_" : ""}${safeFolderName(node.title)}_${node.guid}`;

        let providers;
        try {
          providers = await getProviderRoots(node.guid);
        } catch (e) {
          errors.push(`[${node.guid} "${node.title}"] could not list providers: ${e instanceof Error ? e.message : e}`);
          continue;
        }

        for (const p of providers) {
          const result = await fetchProviderZip(node.guid, p.provider);
          if (result.status === "error") {
            errors.push(`[${node.guid}/${p.provider}] ${result.message}`);
            continue;
          }
          // result.body is a Web ReadableStream; archiver wants a Node Readable.
          const nodeStream = Readable.fromWeb(result.body as unknown as import("node:stream/web").ReadableStream<Uint8Array>);
          archive.append(nodeStream, { name: `${folder}/${p.provider}.zip` });
        }
      }

      if (errors.length > 0) {
        archive.append(
          `BetterOSF whole-tree ZIP — partial failures\n` +
          `Generated for OSF project ${guid} at ${new Date().toISOString()}\n\n` +
          errors.map((e) => `- ${e}`).join("\n") + "\n",
          { name: `${rootTitle}/_BETTEROSF_ERRORS.txt` }
        );
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      archive.append(`Fatal error while assembling ZIP: ${msg}\n`, { name: `_BETTEROSF_FATAL.txt` });
    } finally {
      await archive.finalize();
    }
  })().catch(() => { /* errors already captured above */ });

  // Convert archiver's Node Readable to a Web ReadableStream for the Response.
  const webStream = Readable.toWeb(archive) as unknown as ReadableStream<Uint8Array>;

  return new Response(webStream, {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${rootTitle}_${guid}.zip"`,
      "Cache-Control": "private, no-store",
    },
  });
}
