import archiver from "archiver";
import { Readable } from "node:stream";
import { isValidGuid } from "@/lib/osf/guid";
import { OsfError } from "@/lib/osf/types";
import { collectNodeTree, type TreeNode } from "@/lib/osf/tree";
import { getProviderRoots } from "@/lib/osf/files";
import { fetchProviderZip } from "@/lib/waterbutler/zip";
import { contentDisposition } from "@/lib/http/content-disposition";
import { mapWithConcurrency } from "@/lib/util/concurrency";
import { safeFolderName, nodeFolder, errorsFileName, errorsFileBody } from "@/lib/zip/tree-naming";

export const runtime = "nodejs";
export const maxDuration = 600; // 10 minutes

// Bounded fan-out for the per-node provider-list lookups (the N+1 metadata phase).
// The archive stream itself is consumed serially by archiver, so this only
// parallelizes the OSF round-trips that decide WHAT to append.
const PROVIDER_LIST_CONCURRENCY = 6;

export async function GET(
  req: Request,
  { params }: { params: Promise<{ guid: string }> }
): Promise<Response> {
  const { guid } = await params;
  if (!isValidGuid(guid)) return new Response("Invalid GUID", { status: 400 });

  // Anonymous whole-tree ZIPs: cap at 5 per IP per hour to protect against abuse.
  // Signed-in users have OSF's own 10k/day per-token limit, which is self-throttling.
  // "Signed in" is verified via a real session (auth()), NOT cookie-name presence —
  // a forged `authjs.session-token` cookie must not buy a higher tier on the shared app token.
  // Dynamic import mirrors selectToken(): keeps NextAuth out of non-request contexts.
  const isSignedIn = await (async () => {
    try {
      const { auth } = await import("@/auth");
      const session = await auth();
      return Boolean(session?.accessToken);
    } catch {
      return false;
    }
  })();
  if (!isSignedIn) {
    const ip =
      req.headers.get("x-real-ip") ??
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      "unknown";
    const { incrementWindow } = await import("@/lib/limits");
    const count = await incrementWindow(`ip:${ip}:wholetree-zip:1hr`, 3600);
    if (count > 5) {
      return new Response(
        "Anonymous whole-project ZIP downloads are capped at 5 per IP per hour. Sign in for higher limits.",
        { status: 429, headers: { "Retry-After": "3600", "Content-Type": "text/plain" } }
      );
    }
  }

  let tree: TreeNode[];
  try {
    tree = await collectNodeTree(guid);
  } catch (e) {
    if (e instanceof OsfError && e.code === "not_found") {
      return new Response("Project not found", { status: 404 });
    }
    // Don't leak internal exception text to the client; log it server-side.
    console.error(`[zip/${guid}] failed to walk node tree:`, e);
    return new Response("Failed to assemble this project's ZIP. Please try again later.", { status: 500 });
  }

  const rootTitle = safeFolderName(tree[0]?.title ?? guid);

  // N+1 fix: fetch every node's provider list concurrently up front, preserving
  // tree (DFS) order, instead of one node at a time inside the append loop.
  const nodeProviders = await mapWithConcurrency(tree, PROVIDER_LIST_CONCURRENCY, async (node) => {
    try {
      return { node, providers: await getProviderRoots(node.guid), error: null as string | null };
    } catch (e) {
      return {
        node,
        providers: [] as Awaited<ReturnType<typeof getProviderRoots>>,
        error: `could not list providers: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  });

  const archive = archiver("zip", { zlib: { level: 0 } }); // pre-compressed content
  const errors: string[] = [];
  // L13: an archiver-level stream error (e.g. a source stream aborts) would
  // otherwise reject unhandled and truncate/crash the worker. Capture it.
  archive.on("error", (err) => {
    console.error(`[zip/${guid}] archiver error:`, err);
    errors.push(`archiver error: ${err instanceof Error ? err.message : String(err)}`);
  });
  archive.on("warning", (err) => {
    console.warn(`[zip/${guid}] archiver warning:`, err);
  });

  // Kick off the work in the background; archiver.finalize() will close the stream when done.
  (async () => {
    try {
      for (const { node, providers, error } of nodeProviders) {
        const folder = nodeFolder({
          rootTitle,
          guid: node.guid,
          title: node.title,
          linked: node.linked,
          isRoot: node.guid === guid,
        });

        if (error) {
          errors.push(`[${node.guid} "${node.title}"] ${error}`);
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
        console.warn(`[zip/${guid}] completed with ${errors.length} partial failure(s)`);
        archive.append(
          errorsFileBody({ guid, generatedAt: new Date().toISOString(), problems: errors }),
          { name: errorsFileName(rootTitle) }
        );
      } else {
        console.info(`[zip/${guid}] assembled ${tree.length} node(s) cleanly`);
      }
    } catch (e) {
      console.error(`[zip/${guid}] fatal error while assembling ZIP:`, e);
      archive.append(`Fatal error while assembling ZIP.\n`, { name: `_BETTEROSF_FATAL.txt` });
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
      "Content-Disposition": contentDisposition(`${rootTitle}_${guid}.zip`),
      "Cache-Control": "private, no-store",
    },
  });
}
