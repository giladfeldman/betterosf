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
  if (!isValidGuid(target.guid)) {
    throw new OsfWriteError(400, "invalid", "Invalid GUID");
  }
  if (target.provider !== OSF_STORAGE) {
    throw new OsfWriteError(400, "invalid", "Deleting is only supported for OSF Storage.");
  }
  // Registrations are permanent scientific records — never deletable through BetterOSF.
  // Mirrors the same pin in validateUploadTarget().
  if (!target.listingUrl.startsWith("https://api.osf.io/v2/nodes/")) {
    throw new OsfWriteError(
      400,
      "invalid",
      "Deleting is only supported for project and component OSF Storage. Registrations are permanent and cannot be modified."
    );
  }

  const validated = validateWaterbutlerActionUrl(target.deleteUrl, target.guid);
  const url = new URL(validated);
  // Drop anything the caller appended — notably `confirm_delete`, which would turn a
  // refused root delete into a recursive wipe of every file in the provider.
  url.search = "";
  url.hash = "";

  const prefix = `/v1/resources/${target.guid}/providers/${OSF_STORAGE}`;
  const rest = url.pathname.slice(prefix.length);
  if (rest === "" || rest === "/") {
    throw new OsfWriteError(
      400,
      "invalid",
      "BetterOSF will not delete an entire OSF Storage root. Select the files or folders inside it instead."
    );
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

export function mapUploadStatus(status: number, body: string, verb: "upload" | "delete" = "upload"): OsfWriteError {
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
