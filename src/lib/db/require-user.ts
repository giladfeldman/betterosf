import "server-only";

import { auth } from "@/auth";
import { findUserByOsfId, upsertOsfUser } from "@/lib/db/users";

export async function requireAppUser(): Promise<
  | { ok: true; userId: string; osfUserId: string }
  | { ok: false; status: 401 | 503; error: string }
> {
  const session = await auth().catch(() => null);
  if (!session?.osfUserId) {
    return { ok: false, status: 401, error: "Sign in with OSF to sync favorites and preferences." };
  }
  let row = await findUserByOsfId(session.osfUserId).catch(() => null);
  if (!row) {
    const id = await upsertOsfUser({
      osfUserId: session.osfUserId,
      name: session.user?.name ?? null,
      email: session.user?.email ?? null,
      image: session.user?.image ?? null,
    });
    if (!id) {
      return { ok: false, status: 503, error: "Database unavailable." };
    }
    row = await findUserByOsfId(session.osfUserId).catch(() => null);
  }
  if (!row) {
    return { ok: false, status: 503, error: "Database unavailable." };
  }
  return { ok: true, userId: row.id, osfUserId: session.osfUserId };
}
