/**
 * Anonymous public routes probed after every production deploy.
 *
 * BetterOSF is a public OSF browser: no database, no role-gated areas, and auth
 * is OSF OAuth (so there is no test-login backdoor and no per-role probes). Only
 * Tier-1 anonymous liveness/render probes apply. Edit this list to add or remove
 * public pages — probes.spec.ts consumes it.
 *
 * GUID note: file/registration pages need a real, public OSF GUID. `ezcuj` is
 * the long-standing OSF public demo project ("Reproducibility Project"); if it
 * ever 404s, swap in any stable public project GUID.
 */
export const PUBLIC_GUID = "ezcuj";

export type AnonRoute = {
  /** Path to probe (relative to BASE_URL). */
  path: string;
  /** Human label for the test name. */
  label: string;
};

export const ANON_ROUTES: AnonRoute[] = [
  { path: "/", label: "landing" },
  { path: "/about", label: "about" },
  { path: "/information", label: "information" },
  { path: "/privacy", label: "privacy" },
  { path: "/login", label: "login" },
  { path: "/search?q=open+science", label: "search results" },
  // Added with the page itself in v1.12.0. A public page with no post-deploy probe is a
  // page nobody notices breaking — the same rule as "a page nothing links to is not
  // shipped", one step later in its life.
  { path: "/tools/zenodo-download", label: "Zenodo folder-tree downloader" },
  { path: `/${PUBLIC_GUID}`, label: "public project overview" },
  { path: `/${PUBLIC_GUID}/files`, label: "public project files (tree navigator)" },
];

/**
 * Substrings that, if present in rendered HTML, indicate a crashed render.
 * Next.js App Router surfaces these on an unhandled server/client error.
 * (A 404 "This page could not be found." is deliberately NOT here — it's a
 * normal status, caught by the `status < 500` check, and a transient OSF data
 * 404 on the demo GUID must not fail an otherwise-healthy deploy smoke.)
 */
export const CRASH_MARKERS: string[] = [
  "Application error: a client-side exception has occurred",
  "Application error: a server-side exception has occurred",
  "Internal Server Error",
];
