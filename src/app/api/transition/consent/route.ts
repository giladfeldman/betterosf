import { z } from "zod";
import { requireAppUser } from "@/lib/db/require-user";
import { recordConsent, userHasToolkitConsent } from "@/lib/db/transition-consents";
import { TERMS_VERSION, TRANSITION_DIALOG_CLAUSE_IDS } from "@/lib/terms";
import { logEventAwaited } from "@/lib/logger";

export const runtime = "nodejs";

/** Current consent state for the signed-in user. */
export async function GET(): Promise<Response> {
  const user = await requireAppUser();
  if (!user.ok) {
    return Response.json(
      { signedIn: false, consented: false, termsVersion: TERMS_VERSION },
      { status: user.status === 401 ? 200 : user.status, headers: noStore },
    );
  }
  return Response.json(
    {
      signedIn: true,
      consented: await userHasToolkitConsent(user.osfUserId),
      termsVersion: TERMS_VERSION,
    },
    { headers: noStore },
  );
}

const bodySchema = z.object({
  /**
   * Echoed back by the client so a stale tab cannot agree to terms it never rendered.
   * The stored version is stamped server-side regardless — this is a staleness check,
   * not the source of truth.
   */
  termsVersion: z.string().min(1),
  /** Ids of the clauses the client actually displayed. */
  clauseIds: z.array(z.string()).min(1),
});

/**
 * Record agreement to the transition terms.
 *
 * Rejects a client whose rendered terms do not match the current ones. A tab left open
 * across a TERMS_VERSION bump would otherwise submit agreement to superseded text, and
 * the resulting record would be evidence of something that never happened.
 */
export async function POST(req: Request): Promise<Response> {
  const user = await requireAppUser();
  if (!user.ok) {
    return Response.json({ error: user.error }, { status: user.status, headers: noStore });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Malformed consent submission." }, { status: 400, headers: noStore });
  }

  if (parsed.data.termsVersion !== TERMS_VERSION) {
    return Response.json(
      {
        error: "These terms have been updated. Reload the page and read them again before agreeing.",
        code: "terms_version_mismatch",
        termsVersion: TERMS_VERSION,
      },
      { status: 409, headers: noStore },
    );
  }

  // The client must have rendered every clause we require. Anything less means the
  // clickwrap was incomplete, and consent to text the user never saw is worthless.
  const missing = TRANSITION_DIALOG_CLAUSE_IDS.filter((id) => !parsed.data.clauseIds.includes(id));
  if (missing.length > 0) {
    return Response.json(
      { error: "Incomplete terms were displayed. Reload the page and try again.", code: "incomplete_clauses" },
      { status: 409, headers: noStore },
    );
  }

  await recordConsent({
    userId: user.userId,
    osfUserId: user.osfUserId,
    scope: "toolkit",
    userAgent: req.headers.get("user-agent"),
  });

  // Awaited, not fire-and-forget: the record must exist before the feature unlocks.
  await logEventAwaited(
    "info",
    "transition",
    `Transition terms ${TERMS_VERSION} accepted`,
    { termsVersion: TERMS_VERSION, scope: "toolkit" },
    user.userId,
  );

  return Response.json({ consented: true, termsVersion: TERMS_VERSION }, { headers: noStore });
}

const noStore = { "Cache-Control": "private, no-store" } as const;
