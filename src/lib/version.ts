import pkg from "../../package.json";

/**
 * The running app version, read from package.json at build time.
 *
 * Single source of truth: the badge, the About page, and the bug-report payload
 * all read this, so a reported version can never drift from what actually
 * shipped. Bumping `package.json` is the only place a release number changes.
 */
export const APP_VERSION: string = pkg.version;

/** Display form for the floating badge and footers, e.g. "v1.7.0". */
export const APP_VERSION_LABEL = `v${APP_VERSION}` as const;

/**
 * The deployed git SHA, when the host provides one. Vercel injects
 * VERCEL_GIT_COMMIT_SHA; locally there is none, so this is null and callers
 * must not imply a commit they cannot name.
 */
export function commitSha(): string | null {
  const sha =
    process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ?? process.env.VERCEL_GIT_COMMIT_SHA ?? "";
  return sha ? sha.slice(0, 7) : null;
}
