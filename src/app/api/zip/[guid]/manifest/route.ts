import { isValidGuid } from "@/lib/osf/guid";
import { osfErrorResponse, appErrorResponse } from "@/lib/osf/error-response";
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
    // Use the SHARED mapper, not a hand-rolled branch. This route first shipped collapsing
    // every OSF failure into one 502 "try again later" — which is precisely the defect
    // `osfErrorResponse` was written to kill, and it matters here more than most: OSF's rate
    // limit is a transient 429 with a Retry-After, and calling it 502 tells the client the
    // server broke. The browser-direct button then falls back to the SERVER route, which is
    // the expensive path — so mislabelling a rate limit makes the app answer OSF asking it
    // to slow down by working OSF harder.
    const mapped = osfErrorResponse(e, { endpoint: `/api/zip/${guid}/manifest` });
    if (mapped) return mapped;

    // A timeout talking to OSF is not an `OsfError` — the client's per-attempt AbortSignal
    // fires and the raw `AbortError` is rethrown after its retries. Observed in production
    // while OSF was slow: it landed in the branch below and was reported as **500**, which
    // says "BetterOSF has a bug" about an upstream that was merely busy. 504 is the honest
    // status, and unlike a 429 the client SHOULD fall back to the server route here — a
    // timeout is not OSF asking us to slow down.
    if (e instanceof Error && (e.name === "AbortError" || e.name === "TimeoutError")) {
      console.warn(`[zip/${guid}/manifest] OSF timed out while walking the node tree`);
      return appErrorResponse({
        status: 504,
        code: "osf_timeout",
        error: "OSF took too long to describe this project.",
        action: "Try again in a moment. Large projects with many components are the usual cause.",
        cause: e,
        logType: "osf",
      });
    }

    console.error(`[zip/${guid}/manifest] failed to walk node tree:`, e);
    return appErrorResponse({
      status: 500,
      code: "manifest_failed",
      error: "Could not read this project's structure.",
      action: "Try again. If it keeps failing, the whole-project ZIP still works from the server.",
      cause: e,
      logType: "osf",
    });
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

