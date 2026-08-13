import "server-only";

import { createCipheriv, createDecipheriv, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";
import type { ZenodoEnv } from "./zenodo-env";

/**
 * Where a user's Zenodo access token lives.
 *
 * The model is `/api/osf/upload-token`: the token is held server-side, handed to the
 * browser only for the duration of a run, and kept in memory there — never localStorage,
 * never a readable cookie. Zenodo allows `Authorization` cross-origin (measured), so the
 * browser PUTs bytes straight to `zenodo.org` and no research byte touches Vercel.
 *
 * Server-side storage is a SEALED httpOnly cookie rather than a database row, because:
 *   - it costs nothing (the standing "no paid tiers, no meaningful Vercel usage" rule),
 *   - it disappears when the user's browser session does, which is the right lifetime for
 *     a credential to a third party, and
 *   - it cannot be read by script, so an XSS cannot lift a deposit credential.
 *
 * Sealed with AES-256-GCM under a key derived from AUTH_SECRET, and BOUND to the OSF user
 * id it was issued for. The binding matters: without it, a cookie captured in one account
 * would keep working after signing in as somebody else, and deposits would silently land
 * in the wrong Zenodo account.
 *
 * **No refresh token is stored.** Zenodo's tokens last ~60 days (`expires_in: 5184000`,
 * measured 2026-08-13), and a refresh path we could not exercise for two months would be
 * untested code guarding a credential. An expired connection reports itself as
 * disconnected and the user reconnects in two clicks. If refresh is ever added, it must be
 * proven against the live service first, not written from the spec.
 */

export const ZENODO_SESSION_COOKIE = "betterosf.zenodo";
export const ZENODO_OAUTH_STATE_COOKIE = "betterosf.zenodo_oauth";

/** 10 minutes is longer than any honest authorize round trip and shorter than a coffee. */
export const OAUTH_STATE_TTL_SECONDS = 600;

export type ZenodoSession = {
  accessToken: string;
  env: ZenodoEnv;
  scope: string;
  /** Epoch ms. `null` when Zenodo declined to say, which is treated as "unknown", not "never". */
  expiresAt: number | null;
  /** OSF user this token was issued for. A mismatch invalidates the cookie. */
  osfUserId: string;
};

export type OAuthStatePayload = {
  state: string;
  /** Same-origin path to return to. Validated on the way in AND on the way out. */
  returnTo: string;
  env: ZenodoEnv;
  osfUserId: string;
};

function key(): Buffer {
  const secret = process.env.AUTH_SECRET?.trim();
  if (!secret) {
    // Failing loudly beats sealing with a constant. A silent fallback key would make
    // every deployment's cookies forgeable by anyone who read this file.
    throw new Error(
      "AUTH_SECRET is not set, so the Zenodo connection cannot be sealed. Set it in .env.local (local) or the Vercel project settings.",
    );
  }
  return Buffer.from(hkdfSync("sha256", Buffer.from(secret, "utf8"), Buffer.alloc(0), "betterosf-zenodo-session-v1", 32));
}

/**
 * Seal a value into `v1.<iv>.<tag>.<ciphertext>`, all base64url.
 *
 * Versioned so a future format change can reject old cookies outright instead of
 * misreading them.
 */
export function seal(value: unknown): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const plaintext = Buffer.from(JSON.stringify(value), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", b64(iv), b64(tag), b64(ciphertext)].join(".");
}

/** Open a sealed value. Returns null for anything not exactly right — never throws. */
export function open<T>(sealed: string | undefined | null): T | null {
  if (!sealed) return null;
  const parts = sealed.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key(), unb64(parts[1]!));
    decipher.setAuthTag(unb64(parts[2]!));
    const plaintext = Buffer.concat([decipher.update(unb64(parts[3]!)), decipher.final()]);
    return JSON.parse(plaintext.toString("utf8")) as T;
  } catch {
    // A wrong tag, a rotated AUTH_SECRET, or a truncated cookie all land here. All of them
    // mean "not connected", which is the safe reading.
    return null;
  }
}

function b64(buf: Buffer): string {
  return buf.toString("base64url");
}

function unb64(s: string): Buffer {
  return Buffer.from(s, "base64url");
}

/**
 * Read a Zenodo session, enforcing every condition that makes it usable.
 *
 * Fails closed on all four: unsealable, wrong user, wrong environment, or expired. The
 * environment check exists because a sandbox token used against production (or the
 * reverse) fails with an opaque 401 that costs an hour to diagnose — and because a token
 * scoped to a wipeable instance must never be presented as a way to mint a real DOI.
 */
export function readZenodoSession(
  sealed: string | undefined | null,
  expect: { osfUserId: string; env: ZenodoEnv; now: Date },
): ZenodoSession | null {
  const session = open<ZenodoSession>(sealed);
  if (!session || typeof session.accessToken !== "string" || session.accessToken.length === 0) return null;
  if (session.osfUserId !== expect.osfUserId) return null;
  if (session.env !== expect.env) return null;

  // `null` means "Zenodo did not say when this expires" and is accepted. Anything else
  // non-numeric — a string, NaN, undefined from an older cookie shape — is NOT a licence
  // to treat the token as live: `NaN <= now` is false, so an unparseable expiry would read
  // as "never expires". (Codex consult 2026-08-13.)
  if (session.expiresAt !== null) {
    if (typeof session.expiresAt !== "number" || !Number.isFinite(session.expiresAt)) return null;
    if (session.expiresAt <= expect.now.getTime()) return null;
  }
  return session;
}

/** Constant-time comparison for the OAuth `state`, which is an anti-forgery token. */
export function stateMatches(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length || ba.length === 0) return false;
  return timingSafeEqual(ba, bb);
}

/**
 * Where the callback may send the user afterwards.
 *
 * Same-origin paths only. `startsWith("/")` is NOT an origin check — `//evil.example`
 * starts with a slash and is a protocol-relative URL to another host. That exact mistake
 * shipped once in the feedback feature (v1.7.0) and is pinned by a test there; this is the
 * same guard, written once more where it is needed rather than remembered.
 */
export function safeReturnTo(value: string | null | undefined, fallback: string): string {
  if (!value) return fallback;
  if (!value.startsWith("/")) return fallback;
  if (value.startsWith("//") || value.startsWith("/\\")) return fallback;
  return value;
}

/** A fresh, unguessable OAuth state value. */
export function newOAuthState(): string {
  return randomBytes(32).toString("base64url");
}

/** Cookie attributes shared by both cookies. Secure everywhere except plain-http localhost. */
export function cookieOptions(maxAgeSeconds: number): {
  httpOnly: true;
  sameSite: "lax";
  secure: boolean;
  path: string;
  maxAge: number;
} {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: maxAgeSeconds,
  };
}
