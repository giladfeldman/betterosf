import { auth } from "@/auth";
import { OSF_UPLOAD_SCOPE } from "@/lib/auth/osf-provider";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  const session = await auth().catch(() => null);
  return Response.json({
    signedIn: Boolean(session?.accessToken),
    canWrite: Boolean(session?.osfCanWrite && !session.osfAuthError),
    needsReconnect: Boolean(session?.osfAuthError),
    expiresAt: session?.osfAccessTokenExpires ?? null,
    writeScope: OSF_UPLOAD_SCOPE,
  }, {
    headers: { "Cache-Control": "private, no-store" },
  });
}
