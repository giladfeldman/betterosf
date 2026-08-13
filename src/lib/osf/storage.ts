import "server-only";
import { osfGet } from "./client";
import { extractStorageBytes, type RawStorage, type StorageUsage } from "@/lib/transition/storage-usage";

/**
 * Per-node storage usage — the network half.
 *
 * The shape, its parser, and the "not counted" wording live in
 * `@/lib/transition/storage-usage`, which is client-safe so the inventory table can
 * render the result. This module is `server-only` because it fetches.
 *
 * `/v2/nodes/{guid}/storage/` is CONTRIBUTOR-ONLY: verified 2026-08-13, it returns 401
 * anonymously and **403 even with a valid token** for a public project the caller does
 * not contribute to. It should work for a user's own projects, which is the inventory
 * case — but that could not be confirmed, because the only test account available owns
 * zero projects. ⚠️ Treat the response shape as unverified until a real run proves it.
 */
export type { StorageUsage };

/**
 * Storage usage for one node.
 *
 * Never throws: every failure becomes an explicit `known: false` with a reason, because a
 * thrown error mid-crawl would abort an inventory of hundreds of projects over one
 * project the user happens not to own.
 */
export async function getNodeStorage(guid: string): Promise<StorageUsage> {
  try {
    const raw = await osfGet<RawStorage>(`/nodes/${guid}/storage/`, {
      tags: [`node:${guid}`],
      revalidate: 300,
    });
    const bytes = extractStorageBytes(raw);
    return bytes === null ? { known: false, reason: "unrecognised_shape" } : { known: true, bytes };
  } catch (e) {
    const status = (e as { status?: number })?.status;
    if (status === 403 || status === 401) return { known: false, reason: "forbidden" };
    if (status === 404) return { known: false, reason: "not_found" };
    return { known: false, reason: "error" };
  }
}
