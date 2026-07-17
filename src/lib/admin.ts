import "server-only";

import { auth } from "@/auth";
import { findUserByOsfId } from "@/lib/db/users";

function adminOsfIds(): Set<string> {
  const raw = process.env.ADMIN_OSF_USER_IDS ?? "";
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

export async function isAdminSession(): Promise<boolean> {
  const session = await auth().catch(() => null);
  const osfId = session?.osfUserId;
  if (!osfId) return false;
  if (adminOsfIds().has(osfId)) return true;
  const row = await findUserByOsfId(osfId).catch(() => null);
  return row?.role === "admin";
}

export async function requireAdmin() {
  const session = await auth();
  if (!session?.osfUserId) {
    return { ok: false as const, status: 401 as const, error: "unauthorized" };
  }
  if (!(await isAdminSession())) {
    return { ok: false as const, status: 403 as const, error: "forbidden" };
  }
  return { ok: true as const, session };
}
