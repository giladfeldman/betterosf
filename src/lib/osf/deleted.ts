import { OsfError } from "./types";

/**
 * True when OSF answered HTTP 410 Gone: the resource existed and was DELETED on OSF
 * (measured 2026-10-30 on k3ny2: "The requested node is no longer available.").
 *
 * The OSF client maps 410 to code "not_found" (retrying can never bring it back), so
 * every `e.code === "not_found"` branch also catches a deletion. Check this FIRST in
 * those branches: "deleted on OSF" and "no such id / malformed GUID" are different
 * facts and must not render the same (d-0f12b5; the ZIP route's sibling was d-f2d4f3).
 */
export function isOsfDeleted(e: unknown): boolean {
  return e instanceof OsfError && e.status === 410;
}
