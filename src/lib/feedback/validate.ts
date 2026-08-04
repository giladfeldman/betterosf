/**
 * Validation + normalisation for user-submitted bug reports.
 *
 * Kept free of server-only imports so both the API route and unit tests can
 * exercise the exact same logic — the rules that decide whether a real user's
 * report is stored or silently dropped must not live inside a route handler
 * where they can only be tested through HTTP.
 */

export const FEEDBACK_KINDS = ["bug", "idea", "question"] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];

export const MAX_MESSAGE_LEN = 5000;
export const MIN_MESSAGE_LEN = 5;
export const MAX_URL_LEN = 2000;
export const MAX_UA_LEN = 500;
export const MAX_EMAIL_LEN = 320;

export type FeedbackInput = {
  kind?: unknown;
  message?: unknown;
  contactEmail?: unknown;
  pageUrl?: unknown;
};

export type ValidFeedback = {
  kind: FeedbackKind;
  message: string;
  contactEmail: string | null;
  pageUrl: string | null;
};

export type ValidationResult =
  | { ok: true; value: ValidFeedback }
  | { ok: false; error: string };

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** Deliberately permissive: we would rather store a slightly odd address than
 *  reject a real reporter over a regex. Only obvious non-addresses fail. */
function normaliseEmail(raw: string): string | null {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return null;
  if (trimmed.length > MAX_EMAIL_LEN) return null;
  // Must have a single @, something before it, and a dot-bearing domain after.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return null;
  return trimmed;
}

/** Hosts a stored page URL may point at. Anything else is dropped. */
const ALLOWED_HOSTS = new Set([
  "betterosf.vercel.app",
  "localhost",
  "127.0.0.1",
]);

/**
 * Keep only page URLs that genuinely belong to BetterOSF.
 *
 * The admin inbox renders this as a clickable link, so an unfiltered value lets
 * an anonymous reporter plant a phishing link aimed at the one person who reads
 * every report. Two traps this must catch, both found by cross-model review
 * (codex, 2026-08-04) and reproduced before fixing:
 *
 *  - `//evil.example/x` is PROTOCOL-RELATIVE. It starts with "/" so it looks
 *    like a path, but `new URL("//evil.example/x", origin)` resolves to
 *    `http://evil.example/x` — a different origin entirely.
 *  - `/\evil.example` and `\\evil.example` are treated like `//` by browsers,
 *    so a naive `startsWith("/")` check waves them through too.
 *
 * Absolute URLs are kept only when the host is one of ours.
 */
function normalisePageUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.length > MAX_URL_LEN) return null;

  // Reject anything that resolves off-origin while looking like a path.
  // Covers "//host", "/\host", "\\host", "\/host".
  if (/^[/\\]{2}/.test(trimmed) || /^[/\\][/\\]/.test(trimmed)) return null;
  if (trimmed.startsWith("/") && /^\/[\\]/.test(trimmed)) return null;

  // Genuine relative path.
  if (trimmed.startsWith("/")) return trimmed;

  try {
    const u = new URL(trimmed);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (!ALLOWED_HOSTS.has(u.hostname)) return null;
    return u.toString();
  } catch {
    return null;
  }
}

export function validateFeedback(input: FeedbackInput): ValidationResult {
  const message = asString(input.message).trim();
  if (message.length < MIN_MESSAGE_LEN) {
    return { ok: false, error: "Please describe the problem in a little more detail." };
  }
  if (message.length > MAX_MESSAGE_LEN) {
    return { ok: false, error: `Please keep the report under ${MAX_MESSAGE_LEN} characters.` };
  }

  const rawKind = asString(input.kind) || "bug";
  const kind = (FEEDBACK_KINDS as readonly string[]).includes(rawKind)
    ? (rawKind as FeedbackKind)
    : "bug";

  return {
    ok: true,
    value: {
      kind,
      message,
      contactEmail: normaliseEmail(asString(input.contactEmail)),
      pageUrl: normalisePageUrl(asString(input.pageUrl)),
    },
  };
}

/** Trim a user agent to a storable length without throwing on absence. */
export function truncateUserAgent(ua: string | null | undefined): string | null {
  if (!ua) return null;
  return ua.slice(0, MAX_UA_LEN);
}
