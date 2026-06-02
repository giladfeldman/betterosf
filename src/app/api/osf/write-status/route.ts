import { auth } from "@/auth";
import { OSF_READ_SCOPE, OSF_WRITE_SCOPE } from "@/lib/auth/osf-provider";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  const session = await auth().catch(() => null);
  return Response.json({
    signedIn: Boolean(session?.accessToken),
    canWrite: Boolean(session?.osfCanWrite),
    writeScope: `${OSF_READ_SCOPE} ${OSF_WRITE_SCOPE}`,
  }, {
    headers: { "Cache-Control": "private, no-store" },
  });
}
