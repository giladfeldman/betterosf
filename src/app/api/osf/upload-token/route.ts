import { auth } from "@/auth";

export const runtime = "nodejs";

/**
 * GET /api/osf/upload-token
 *
 * Hands the signed-in, write-capable session its short-lived OSF access token so
 * the BROWSER can PUT file bytes straight to OSF Waterbutler — bypassing Vercel's
 * 4.5 MB function body limit so uploads of any size (up to OSF's 5 GB/file) work.
 *
 * Security posture (see docs/engineering/stack-and-conventions.md, "File uploads go DIRECT"):
 *  - Only the access token is returned; the refresh token never leaves the server.
 *  - `no-store` so the token is never cached by the browser/proxies.
 *  - The client keeps it in memory only (never localStorage/cookie), pins it to
 *    `files.osf.io` destinations, and discards it after the upload batch.
 */
export async function GET(): Promise<Response> {
  const noStore = { "Cache-Control": "private, no-store" };
  const session = await auth().catch(() => null);
  if (!session?.accessToken) {
    return Response.json(
      { error: "Sign in with OSF to upload files.", code: "unauthorized" },
      { status: 401, headers: noStore }
    );
  }
  if (!session.osfCanWrite || session.osfAuthError) {
    return Response.json(
      { error: "Enable OSF uploads to grant write access.", code: "forbidden" },
      { status: 403, headers: noStore }
    );
  }
  return Response.json(
    { token: session.accessToken, expiresAt: session.osfAccessTokenExpires ?? null },
    { headers: noStore }
  );
}
