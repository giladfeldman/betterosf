import { isValidGuid } from "@/lib/osf/guid";
import { OsfError } from "@/lib/osf/types";
import { collectNodeTree, type TreeNode } from "@/lib/osf/tree";
import { getProviderRoots } from "@/lib/osf/files";
import { mapWithConcurrency } from "@/lib/util/concurrency";
import { safeFolderName, nodeFolder } from "@/lib/zip/tree-naming";

export const runtime = "nodejs";
export const maxDuration = 60;

const PROVIDER_LIST_CONCURRENCY = 6;

/**
 * The shopping list for a browser-direct whole-tree ZIP: which nodes, which providers, and
 * what to call each entry in the archive.
 *
 * **No file bytes pass through here, and no file enumeration happens either.** The browser
 * fetches one Waterbutler `?zip=` stream per (node, provider) and nests them exactly as the
 * server route does, so this endpoint answers with a few kilobytes of JSON no matter how
 * large the project is. That is the entire point: `/api/zip/[guid]` streams every byte
 * through a Vercel function, and one researcher zipping 5 GB costs 5 GB of egress.
 *
 * Anonymous by design, like the route it replaces. Waterbutler serves a public project's
 * bytes without a credential — it just needs an `Authorization` header present for CORS,
 * which `osfBrowserAuthHeader` supplies.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ guid: string }> },
): Promise<Response> {
  const { guid } = await params;
  if (!isValidGuid(guid)) return Response.json({ error: "Invalid GUID" }, { status: 400 });

  // Rate-limited on the SAME budget as `/api/zip/[guid]`, and deliberately on the same key.
  //
  // This endpoint returns a few KB of JSON, but producing it walks up to 500 nodes at
  // `getNode` + `getProviderRoots` each — up to ~1000 OSF requests per call, made with
  // BetterOSF's own app token when the caller is anonymous. Left uncapped it would be an
  // amplifier against OSF under a shared credential, and it would burn the Vercel function
  // budget this whole browser-direct feature exists to protect.
  //
  // Sharing the key with the ZIP route matters: a separate budget would let one caller take
  // 5 server-assembled ZIPs *and* an unlimited number of manifests. Moving bytes out of the
  // function must not quietly move the cap out with them.
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
      return Response.json(
        {
          error:
            "Anonymous whole-project ZIP downloads are capped at 5 per IP per hour. Sign in for higher limits.",
        },
        { status: 429, headers: { "Retry-After": "3600" } },
      );
    }
  }

  let tree: TreeNode[];
  try {
    tree = await collectNodeTree(guid);
  } catch (e) {
    if (e instanceof OsfError && e.code === "not_found") {
      return Response.json({ error: "Project not found" }, { status: 404 });
    }
    console.error(`[zip/${guid}/manifest] failed to walk node tree:`, e);
    return Response.json(
      { error: "Could not read this project's structure from OSF. Please try again later." },
      { status: 502 },
    );
  }

  const rootTitle = safeFolderName(tree[0]?.title ?? guid);

  const rows = await mapWithConcurrency(tree, PROVIDER_LIST_CONCURRENCY, async (node) => {
    const folder = nodeFolder({ rootTitle, guid: node.guid, title: node.title, linked: node.linked, isRoot: node.guid === guid });
    try {
      const providers = await getProviderRoots(node.guid);
      return {
        guid: node.guid,
        title: node.title,
        folder,
        linked: node.linked,
        providers: providers.map((p) => p.provider),
        // Null, never an empty provider list: "we could not ask" and "this node has no
        // storage" produce the same archive but are different facts, and the client says
        // so in the errors file it writes into the ZIP.
        error: null as string | null,
      };
    } catch (e) {
      return {
        guid: node.guid,
        title: node.title,
        folder,
        linked: node.linked,
        providers: [] as string[],
        error: `could not list providers: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  });

  return Response.json(
    {
      guid,
      rootTitle,
      filename: `${rootTitle}_${guid}.zip`,
      nodes: rows,
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

