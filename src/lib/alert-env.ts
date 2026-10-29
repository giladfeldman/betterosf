/**
 * Where an event happened, and whether an admin email about it may be sent (d-bf671b).
 *
 * The owner's rule (2026-10-23): admin emails are for urgent PRODUCTION problems. A local
 * test run must never produce an email that looks like one. So:
 *
 *   1. The environment comes from the deploy platform's own marker (`VERCEL_ENV`, plus the
 *      Railway / Render equivalents), never from `NODE_ENV` — `npm start` on a laptop runs
 *      with NODE_ENV=production. A process with no platform marker is `local`.
 *   2. Only `production` is emailed by default. Everything else is still recorded (the log
 *      table, /admin/feedback), just not emailed.
 *   3. `ALERT_EMAILS_NON_PRODUCTION=1` opts in, and then the subject STARTS with
 *      `[LOCAL TEST - NOT PRODUCTION]` (or the environment's own name) and the body opens with
 *      a banner saying no production user was affected.
 *
 * Local dev shares the production database, so log rows carry this label (`_env`) and the
 * daily digest filters on it — the label belongs to the event's ORIGIN, not to whichever
 * process later reads it.
 */

export type DeploymentEnvironment = "production" | "preview" | "development" | "local";

export function deploymentEnvironment(): DeploymentEnvironment {
  const vercel = process.env.VERCEL_ENV?.trim().toLowerCase();
  if (vercel === "production" || vercel === "preview" || vercel === "development") return vercel;
  const railway = process.env.RAILWAY_ENVIRONMENT_NAME?.trim().toLowerCase();
  if (railway) return railway === "production" ? "production" : "preview";
  if (process.env.RENDER?.trim()) return process.env.IS_PULL_REQUEST === "true" ? "preview" : "production";
  return "local";
}

export const LOCAL_TEST_SUBJECT_PREFIX = "[LOCAL TEST - NOT PRODUCTION]";

export type AlertEmailPolicy = {
  send: boolean;
  /** Apply to every alert subject; a no-op for production. */
  subject: (subject: string) => string;
  /** First line of the body for a non-production email; null for production. */
  banner: string | null;
};

export function alertEmailPolicy(
  env: DeploymentEnvironment = deploymentEnvironment(),
  opts: { optIn?: boolean } = {},
): AlertEmailPolicy {
  if (env === "production") return { send: true, subject: (s) => s, banner: null };
  const optIn = opts.optIn ?? process.env.ALERT_EMAILS_NON_PRODUCTION?.trim() === "1";
  const prefix = env === "local" ? LOCAL_TEST_SUBJECT_PREFIX : `[${env.toUpperCase()} - NOT PRODUCTION]`;
  return {
    send: optIn,
    subject: (s) => `${prefix} ${s}`,
    banner:
      `${env === "local" ? "LOCAL TEST" : env.toUpperCase()} — NOT PRODUCTION. ` +
      `This came from a ${env} BetterOSF, not the live site; no production user was affected.`,
  };
}
