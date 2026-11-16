import { isValidGuid } from "@/lib/osf/guid";
import { getAllChildren } from "@/lib/osf/nodes";
import { osfErrorResponse } from "@/lib/osf/error-response";
import type { ComponentTree } from "@/lib/osf/full-tree";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * The components of one OSF node, for the navigator's nested-component rows.
 *
 * Called only when a user opens a component that has components of its own, so a
 * project with 100 components costs nothing until someone drills in. Each child
 * comes back un-hydrated (`skipped: true`); its folders load when it is opened.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ guid: string }> }
): Promise<Response> {
  const { guid } = await params;
  if (!isValidGuid(guid)) return new Response("Invalid GUID", { status: 400 });

  try {
    const kids = await getAllChildren(guid);
    const children: ComponentTree[] = kids.map((c) => ({
      guid: c.id,
      title: c.title || c.id,
      category: c.category,
      isPublic: c.public,
      skeleton: [],
      skipped: true,
      ...(c.childCount !== undefined ? { childCount: c.childCount } : {}),
    }));
    return Response.json({ children }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    const mapped = osfErrorResponse(e);
    if (mapped) return mapped;
    console.error(`[osf/children/${guid}] error:`, e);
    return new Response("Could not load this component's components. Please try again later.", { status: 500 });
  }
}
