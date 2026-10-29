// Shared, client-safe OSF Waterbutler URL building + destination validation.
//
// This module is imported by BOTH the server write helper (src/lib/osf/write.ts)
// and the browser direct-upload helper (src/lib/upload/direct.ts). It is the single
// source of truth for "which URL may we send an OSF token to" — the browser pins the
// access token to these destinations so it is never sent anywhere but OSF Waterbutler.
//
// IMPORTANT: do NOT add `import "server-only"` here — it must remain client-safe.

import { isValidGuid } from "./guid";

export const WATERBUTLER_BASE = "https://files.osf.io/v1/resources";
export const OSF_STORAGE = "osfstorage";
/** OSF Storage allows up to 5 GB per file. */
export const OSF_MAX_FILE_SIZE = 5 * 1024 * 1024 * 1024;

export class OsfWriteError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: "unauthorized" | "forbidden" | "conflict" | "too_large" | "invalid" | "upstream",
    message: string
  ) {
    super(message);
  }
}

export type UploadTarget = {
  guid: string;
  provider: string;
  path: string;
  listingUrl: string;
  uploadUrl?: string;
  newFolderUrl?: string;
};

export function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

export function cleanPath(path: string): string {
  const raw = path.split("/").map(safeDecode).filter((seg) => seg.length > 0);
  if (raw.some((seg) => seg === "." || seg === ".." || seg.includes("/") || seg.includes("\\"))) {
    throw new OsfWriteError(400, "invalid", "Invalid upload path");
  }
  return raw.length === 0 ? "/" : `/${raw.join("/")}/`;
}

export function cleanName(name: string): string {
  const trimmed = safeDecode(name.trim());
  if (!trimmed || trimmed === "." || trimmed === ".." || trimmed.includes("/") || trimmed.includes("\\")) {
    throw new OsfWriteError(400, "invalid", "Invalid file or folder name");
  }
  return trimmed;
}

/** Waterbutler/OSF tolerate long names; this cap only guards against abuse. */
export const MAX_RENAME_NAME_LENGTH = 1024;

/**
 * Validate a user-typed NEW name for a rename. Unlike cleanName this does NOT
 * percent-decode: the input is typed by the user, not lifted from a URL, so a
 * literal "%20" in the box must stay a literal "%20" in the name.
 */
export function cleanRenameName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed || trimmed === "." || trimmed === "..") {
    throw new OsfWriteError(400, "invalid", "Enter a new file or folder name.");
  }
  if (trimmed.includes("/") || trimmed.includes("\\")) {
    throw new OsfWriteError(400, "invalid", "Names cannot contain slashes.");
  }
  if (trimmed.length > MAX_RENAME_NAME_LENGTH) {
    throw new OsfWriteError(400, "invalid", `Names are limited to ${MAX_RENAME_NAME_LENGTH} characters.`);
  }
  return trimmed;
}

function encodePath(path: string): string {
  const cleaned = cleanPath(path);
  const parts = cleaned.split("/").filter(Boolean).map(encodeURIComponent);
  return parts.length > 0 ? `${parts.join("/")}/` : "";
}

function targetUrl(target: UploadTarget, kind: "file" | "folder", name: string): string {
  const path = encodePath(target.path);
  const url = new URL(`${WATERBUTLER_BASE}/${target.guid}/providers/${OSF_STORAGE}/${path}`);
  url.searchParams.set("kind", kind);
  url.searchParams.set("name", name);
  return url.toString();
}

export function cleanOptionalUrl(value: string | undefined): string | undefined {
  const trimmed = (value ?? "").trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function validateWaterbutlerActionUrl(urlString: string, guid: string): string {
  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    throw new OsfWriteError(400, "invalid", "Invalid OSF upload URL.");
  }
  const prefix = `/v1/resources/${guid}/providers/${OSF_STORAGE}`;
  // Also assert no explicit port and no embedded credentials — neither is
  // exploitable today (the host regex already pins *.osf.io), but a URL like
  // `https://user:pass@files.osf.io:1234/...` should never reach an OSF token.
  const hostAllowed =
    url.protocol === "https:" &&
    url.port === "" &&
    url.username === "" &&
    url.password === "" &&
    /^files(?:\.[a-z]{2}-\d+)?\.osf\.io$/i.test(url.hostname);
  if (!hostAllowed || !url.pathname.toLowerCase().startsWith(prefix.toLowerCase())) {
    throw new OsfWriteError(
      400,
      "invalid",
      "BetterOSF could not verify this OSF upload destination. Refresh the project page and choose an OSF Storage folder again. If this repeats, send us the project URL and folder path."
    );
  }
  return url.toString();
}

export function actionUrl(target: UploadTarget, kind: "file" | "folder", name: string): string {
  const candidate = kind === "folder"
    ? cleanOptionalUrl(target.newFolderUrl) ?? cleanOptionalUrl(target.uploadUrl)
    : cleanOptionalUrl(target.uploadUrl);
  const url = new URL(candidate ? validateWaterbutlerActionUrl(candidate, target.guid) : targetUrl(target, kind, name));
  url.searchParams.set("kind", kind);
  url.searchParams.set("name", name);
  return url.toString();
}

/**
 * A single file/folder the user has asked to delete.
 *
 * `deleteUrl` comes from OSF's own `links.delete` on the file entry — we never
 * synthesize it. `listingUrl` is carried purely so `resolveDeleteUrl` can pin the
 * target to a project/component (see the registration check below); it is not used
 * to build the request.
 */
export type DeleteTarget = {
  guid: string;
  provider: string;
  kind: "file" | "folder";
  path: string;
  name: string;
  deleteUrl: string;
  listingUrl: string;
};

/**
 * Validate and normalize a Waterbutler delete URL. This is the security core of the
 * delete feature — everything else trusts what this returns.
 *
 * The ORDER of these checks is load-bearing:
 *
 *   1. The registration pin (step 2) is the ONLY thing distinguishing a registration
 *      from a node. Their Waterbutler URLs are origin-identical, so the host/prefix
 *      check below cannot tell them apart. Registrations are immutable on OSF; the
 *      `readOnly` React prop is a UI affordance, NOT a security boundary.
 *
 *   2. The query string is stripped (step 4) BEFORE the root check (step 5). Waterbutler's
 *      `?confirm_delete=1` is required for root deletes only, and a root delete does not
 *      delete the root — it recursively deletes ALL of its contents. Stripping first means
 *      no client input can smuggle that parameter past the root refusal.
 *
 *   3. The trailing slash is derived from `kind` (step 6), never trusted from the URL.
 *      Waterbutler distinguishes files from folders by the trailing slash, so a mangled
 *      URL must be corrected rather than sent as-is at a different resource.
 */
export function resolveDeleteUrl(target: DeleteTarget): string {
  return resolveItemActionUrl(target, target.deleteUrl, {
    providerRefusal: "Deleting is only supported for OSF Storage.",
    registrationRefusal:
      "Deleting is only supported for project and component OSF Storage. Registrations are permanent and cannot be modified.",
    rootRefusal: "BetterOSF will not delete an entire OSF Storage root. Select the files or folders inside it instead.",
  });
}

/**
 * A single file/folder the user has asked to rename in place.
 *
 * `moveUrl` is the item's own Waterbutler URL, taken from OSF's `links.move` /
 * `links.delete` on the file entry (OSF serves the IDENTICAL URL under both keys —
 * the tree carries it as `deleteUrl`). We never synthesize it. `listingUrl` exists
 * purely for the registration pin, exactly as in DeleteTarget.
 */
export type RenameTarget = {
  guid: string;
  provider: string;
  kind: "file" | "folder";
  path: string;
  name: string;
  moveUrl: string;
  listingUrl: string;
};

export function resolveRenameUrl(target: RenameTarget): string {
  return resolveItemActionUrl(target, target.moveUrl, {
    providerRefusal: "Renaming is only supported for OSF Storage.",
    registrationRefusal:
      "Renaming is only supported for project and component OSF Storage. Registrations are permanent and cannot be modified.",
    rootRefusal: "BetterOSF will not rename an OSF Storage root.",
  });
}

export function resolveMoveUrl(target: RenameTarget): string {
  return resolveItemActionUrl(target, target.moveUrl, {
    providerRefusal: "Moving is only supported for OSF Storage.",
    registrationRefusal:
      "Moving is only supported for project and component OSF Storage. Registrations are permanent and cannot be modified.",
    rootRefusal: "BetterOSF will not move an OSF Storage root.",
  });
}

/**
 * The Waterbutler provider path of a move DESTINATION, derived from the folder's OSF API
 * listing URL — never taken from the client as a path. Only two shapes are accepted, both
 * on the SAME node and on osfstorage:
 *   https://api.osf.io/v2/nodes/<guid>/files/osfstorage/              → "/"  (the root)
 *   https://api.osf.io/v2/nodes/<guid>/files/osfstorage/<24 hex>/     → "/<24 hex>/"
 * An osfstorage folder's id in the listing URL IS its provider path (measured 2026-10-29).
 * Anything else — a registration, another node, another provider, a query string — throws.
 */
export function moveDestinationPath(guid: string, destListingUrl: string): string {
  if (!isValidGuid(guid)) throw new OsfWriteError(400, "invalid", "Invalid GUID");
  const prefix = `https://api.osf.io/v2/nodes/${guid}/files/${OSF_STORAGE}/`;
  const rest = destListingUrl.startsWith(prefix) ? destListingUrl.slice(prefix.length) : null;
  const m = rest === null ? null : /^(?:([0-9a-f]{24})\/)?$/.exec(rest);
  if (!m) {
    throw new OsfWriteError(
      400,
      "invalid",
      "Items can only be moved to a folder in the same project's OSF Storage.",
    );
  }
  return m[1] ? `/${m[1]}/` : "/";
}

/**
 * Shared validation core for per-item Waterbutler actions (delete, rename).
 * The ORDER of the checks — registration pin, then host pin, then query strip,
 * then root refusal, then kind-derived slash — is load-bearing; see the
 * resolveDeleteUrl doc comment above.
 */
function resolveItemActionUrl(
  target: Pick<DeleteTarget, "guid" | "provider" | "kind" | "listingUrl">,
  itemUrl: string,
  messages: { providerRefusal: string; registrationRefusal: string; rootRefusal: string }
): string {
  if (!isValidGuid(target.guid)) {
    throw new OsfWriteError(400, "invalid", "Invalid GUID");
  }
  if (target.provider !== OSF_STORAGE) {
    throw new OsfWriteError(400, "invalid", messages.providerRefusal);
  }
  // Registrations are permanent scientific records — never mutable through BetterOSF.
  // Mirrors the same pin in validateUploadTarget().
  if (!target.listingUrl.startsWith("https://api.osf.io/v2/nodes/")) {
    throw new OsfWriteError(400, "invalid", messages.registrationRefusal);
  }

  const validated = validateWaterbutlerActionUrl(itemUrl, target.guid);
  const url = new URL(validated);
  // Drop anything the caller appended — notably `confirm_delete`, which would turn a
  // refused root delete into a recursive wipe of every file in the provider.
  url.search = "";
  url.hash = "";

  const prefix = `/v1/resources/${target.guid}/providers/${OSF_STORAGE}`;
  const rest = url.pathname.slice(prefix.length);
  if (rest === "" || rest === "/") {
    throw new OsfWriteError(400, "invalid", messages.rootRefusal);
  }

  url.pathname =
    target.kind === "folder"
      ? `${url.pathname.replace(/\/+$/, "")}/`
      : url.pathname.replace(/\/+$/, "");

  return url.toString();
}

export function readableUpstreamBody(body: string): string {
  const trimmed = body.trim();
  if (!trimmed) return "";
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (parsed && typeof parsed === "object") {
      const record = parsed as Record<string, unknown>;
      const message = record.message ?? record.detail ?? record.error;
      if (typeof message === "string" && message.trim()) return message.trim();
      if (Array.isArray(record.errors)) {
        const first = record.errors[0] as unknown;
        if (first && typeof first === "object") {
          const firstMessage = (first as Record<string, unknown>).detail ?? (first as Record<string, unknown>).message;
          if (typeof firstMessage === "string" && firstMessage.trim()) return firstMessage.trim();
        }
      }
    }
  } catch {
    // Fall through to the HTML/plain-text handling below.
  }
  if (/^\s*<!doctype html/i.test(trimmed) || /^\s*<html/i.test(trimmed)) {
    const title = trimmed.match(/<title[^>]*>(.*?)<\/title>/is)?.[1]?.replace(/\s+/g, " ").trim();
    return title ? `OSF returned an HTML error page: ${title}` : "OSF returned an HTML error page instead of an upload response.";
  }
  return trimmed.replace(/\s+/g, " ").slice(0, 300);
}

export function mapUploadStatus(status: number, body: string, verb: "upload" | "delete" | "rename" | "move" = "upload"): OsfWriteError {
  const message = readableUpstreamBody(body);
  if (status === 401) return new OsfWriteError(401, "unauthorized", "Your OSF session expired. Sign in again.");
  if (status === 403) return new OsfWriteError(403, "forbidden", "You may not have write permission on this project or component.");
  if (status === 409) return new OsfWriteError(409, "conflict", message || "A file or folder with that name already exists.");
  if (status === 413) return new OsfWriteError(413, "too_large", "OSF rejected this upload as too large.");
  return new OsfWriteError(status, "upstream", message || `OSF ${verb} failed with status ${status}.`);
}

export function validateUploadTarget(target: UploadTarget): UploadTarget {
  if (!isValidGuid(target.guid)) throw new OsfWriteError(400, "invalid", "Invalid GUID");
  if (target.provider !== OSF_STORAGE) {
    throw new OsfWriteError(400, "invalid", "Uploads are only supported for OSF Storage.");
  }
  if (!target.listingUrl.startsWith("https://api.osf.io/v2/nodes/")) {
    throw new OsfWriteError(400, "invalid", "Uploads are only supported for project and component OSF Storage.");
  }
  return {
    ...target,
    path: cleanPath(target.path),
    uploadUrl: cleanOptionalUrl(target.uploadUrl),
    newFolderUrl: cleanOptionalUrl(target.newFolderUrl),
  };
}

/**
 * A Waterbutler URL the BROWSER can actually fetch a file's bytes from.
 *
 * This exists because the export was fetching `links.download` — `https://osf.io/download/<id>/` —
 * and **every single file failed** with "NetworkError when attempting to fetch resource".
 * Measured 2026-08-14, all four facts:
 *
 *   - `https://osf.io/download/<id>/` sends **no CORS headers at all** (`ACAO: null` on both
 *     the preflight and the GET). A browser `fetch` carrying `Authorization` triggers a
 *     preflight, the preflight fails, and no request is ever made. Server-side callers (the
 *     ZIP route, the download proxy) are unaffected, which is why this went unnoticed: it
 *     only breaks in a browser, and only the transition toolkit fetches OSF from one.
 *   - The Waterbutler URL for the same file answers the preflight with
 *     `ACAO: <our origin>` and `Access-Control-Allow-Headers: Range, …, Authorization`.
 *   - **But plain Waterbutler 302s to `storage.googleapis.com`, which sends no CORS headers
 *     either** — so following the redirect fails too. This is the trap: the redirect makes
 *     Waterbutler *look* usable when checked with a server-side client, because Node's
 *     fetch does not enforce CORS at all.
 *   - **`?direct=` makes Waterbutler stream the bytes itself**, no redirect, CORS intact.
 *     That is the only form that works from a browser.
 *
 * Note the response is then `200` even for a ranged request, with no `Content-Range` — the
 * bytes ARE the requested range (verified by comparing them against the whole file), but
 * the server does not say so. `checkRangeResponse` therefore cannot confirm a resume and
 * restarts the file instead, which is the safe reading of an unverifiable claim.
 */
/**
 * The `Authorization` header value a BROWSER must send to Waterbutler, even for a public
 * file it needs no credential for.
 *
 * Measured 2026-08-14, and this is the whole finding:
 *
 *   - Waterbutler emits `Access-Control-Allow-Origin` **only when the request carries an
 *     `Authorization` header**. Anonymously it answers `200` with the real bytes and NO
 *     ACAO, so a browser discards the response and reports an opaque CORS failure. No
 *     other allowed header flips it — not `X-Requested-With`, not `Cache-Control`, not
 *     `Range`, not `X-CSRFToken`. Only `Authorization`, and any value does it:
 *     `Bearer x`, `Basic x`, even a bare `x`.
 *   - The value is **not** used for authorization. On a PRIVATE file the same placeholder
 *     still returns **403**, and the real token returns 200. So this flips the CORS branch
 *     and nothing else — it is not a bypass, and it cannot become one.
 *   - The bytes fetched with the placeholder are md5-identical to the bytes fetched with a
 *     real token, on a public file and on a public registration's file.
 *
 * The placeholder is spelled out rather than random so that anyone reading an OSF access
 * log, or this code, can see exactly what it is: a marker, not a credential.
 *
 * Undocumented behaviour, so every caller must degrade rather than depend: the
 * browser-direct download paths fall back to the server route when a direct fetch fails.
 */
export const PUBLIC_FETCH_PLACEHOLDER_TOKEN = "betterosf-public-file-no-credential";

export function osfBrowserAuthHeader(token: string | null | undefined): string {
  const trimmed = (token ?? "").trim();
  return `Bearer ${trimmed.length > 0 ? trimmed : PUBLIC_FETCH_PLACEHOLDER_TOKEN}`;
}

/**
 * Waterbutler's own archive of a provider root or a folder, browser-fetchable.
 *
 * `?zip=` streams a ZIP of everything beneath the path. It answers the CORS preflight and
 * sends ACAO on the real response under the same `Authorization` rule above (measured on a
 * provider root and on a nested folder, 2026-08-14 — the latter returned a real `PK`
 * archive).
 *
 * This is what makes a browser-direct whole-tree download cheap: one request per
 * (node, provider) instead of enumerating every file, and byte-for-byte the same nesting
 * the server route produces.
 */
export function waterbutlerZipUrl(input: {
  guid: string;
  provider: string;
  /** Folder path within the provider, or "/" for the whole provider. */
  path?: string;
}): string {
  if (!isValidGuid(input.guid)) {
    throw new OsfWriteError(400, "invalid", `Not a valid OSF guid: ${input.guid}`);
  }
  const provider = input.provider.trim();
  if (!provider || provider.includes("/")) {
    throw new OsfWriteError(400, "invalid", `Not a valid storage provider: ${input.provider}`);
  }
  const encoded = (input.path ?? "/")
    .split("/")
    .filter((seg) => seg.length > 0)
    .map((seg) => encodeURIComponent(safeDecode(seg)))
    .join("/");
  return `${WATERBUTLER_BASE}/${input.guid}/providers/${provider}/${encoded ? `${encoded}/` : ""}?zip=`;
}

export function waterbutlerDownloadUrl(input: {
  guid: string;
  provider: string;
  /** OSF's `attributes.path`, e.g. "/659f816ef2240f03a732e177". Already leading-slashed. */
  path: string;
}): string {
  if (!isValidGuid(input.guid)) {
    throw new OsfWriteError(400, "invalid", `Not a valid OSF guid: ${input.guid}`);
  }
  const provider = input.provider.trim();
  if (!provider || provider.includes("/")) {
    throw new OsfWriteError(400, "invalid", `Not a valid storage provider: ${input.provider}`);
  }
  // The path is an opaque provider-side id or path. Encode each segment but keep the
  // separators, exactly as the file-view page does.
  const encoded = input.path
    .split("/")
    .filter((seg) => seg.length > 0)
    .map((seg) => encodeURIComponent(safeDecode(seg)))
    .join("/");
  if (!encoded) {
    throw new OsfWriteError(400, "invalid", "Empty file path");
  }
  return `${WATERBUTLER_BASE}/${input.guid}/providers/${provider}/${encoded}?direct=`;
}
