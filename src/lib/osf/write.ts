import "server-only";
import { auth } from "@/auth";
import { isValidGuid } from "./guid";
import { getFolderContents } from "./files";

const WATERBUTLER_BASE = "https://files.osf.io/v1/resources";
const OSF_STORAGE = "osfstorage";
const MAX_FILE_SIZE = 1024 * 1024 * 1024;

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

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function cleanPath(path: string): string {
  const raw = path.split("/").map(safeDecode).filter((seg) => seg.length > 0);
  if (raw.some((seg) => seg === "." || seg === ".." || seg.includes("/") || seg.includes("\\"))) {
    throw new OsfWriteError(400, "invalid", "Invalid upload path");
  }
  return raw.length === 0 ? "/" : `/${raw.join("/")}/`;
}

function cleanName(name: string): string {
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

function cleanOptionalUrl(value: string | undefined): string | undefined {
  const trimmed = (value ?? "").trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function validateWaterbutlerActionUrl(urlString: string, guid: string): string {
  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    throw new OsfWriteError(400, "invalid", "Invalid OSF upload URL.");
  }
  const prefix = `/v1/resources/${guid}/providers/${OSF_STORAGE}`;
  const hostAllowed = url.protocol === "https:" && /^files(?:\.[a-z]{2}-\d+)?\.osf\.io$/i.test(url.hostname);
  if (!hostAllowed || !url.pathname.toLowerCase().startsWith(prefix.toLowerCase())) {
    throw new OsfWriteError(
      400,
      "invalid",
      "BetterOSF could not verify this OSF upload destination. Refresh the project page and choose an OSF Storage folder again. If this repeats, send us the project URL and folder path."
    );
  }
  return url.toString();
}

function actionUrl(target: UploadTarget, kind: "file" | "folder", name: string): string {
  const candidate = kind === "folder"
    ? cleanOptionalUrl(target.newFolderUrl) ?? cleanOptionalUrl(target.uploadUrl)
    : cleanOptionalUrl(target.uploadUrl);
  const url = new URL(candidate ? validateWaterbutlerActionUrl(candidate, target.guid) : targetUrl(target, kind, name));
  url.searchParams.set("kind", kind);
  url.searchParams.set("name", name);
  return url.toString();
}

export async function requireOsfWriteToken(): Promise<string> {
  const session = await auth().catch(() => null);
  if (!session?.accessToken) {
    throw new OsfWriteError(401, "unauthorized", "Sign in with OSF to upload files.");
  }
  if (!session.osfCanWrite) {
    throw new OsfWriteError(403, "forbidden", "Enable OSF uploads to grant write access.");
  }
  return session.accessToken;
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

async function ensureNoDuplicate(target: UploadTarget, name: string): Promise<void> {
  const entries = await getFolderContents(target.listingUrl, target.guid);
  if (entries.some((entry) => entry.name === name)) {
    throw new OsfWriteError(409, "conflict", `"${name}" already exists in this folder.`);
  }
}

function readableUpstreamBody(body: string): string {
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

function mapUploadStatus(status: number, body: string): OsfWriteError {
  const message = readableUpstreamBody(body);
  if (status === 401) return new OsfWriteError(401, "unauthorized", "Your OSF session expired. Sign in again.");
  if (status === 403) return new OsfWriteError(403, "forbidden", "You may not have write permission on this project or component.");
  if (status === 409) return new OsfWriteError(409, "conflict", message || "A file or folder with that name already exists.");
  if (status === 413) return new OsfWriteError(413, "too_large", "OSF rejected this upload as too large.");
  return new OsfWriteError(status, "upstream", message || `OSF upload failed with status ${status}.`);
}

export async function uploadFileToOsfStorage(
  target: UploadTarget,
  file: File,
  opts: { overwrite?: boolean } = {}
): Promise<unknown> {
  const checked = validateUploadTarget(target);
  const name = cleanName(file.name);
  if (file.size > MAX_FILE_SIZE) {
    throw new OsfWriteError(413, "too_large", "BetterOSF currently limits uploads to 1 GB per file.");
  }
  const token = await requireOsfWriteToken();
  if (!opts.overwrite) await ensureNoDuplicate(checked, name);
  const res = await fetch(actionUrl(checked, "file", name), {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    body: file,
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw mapUploadStatus(res.status, body.slice(0, 500));
  }
  return res.json().catch(() => ({}));
}

export async function createOsfStorageFolder(target: UploadTarget, name: string): Promise<unknown> {
  const checked = validateUploadTarget(target);
  const folderName = cleanName(name);
  const token = await requireOsfWriteToken();
  await ensureNoDuplicate(checked, folderName);
  const res = await fetch(actionUrl(checked, "folder", folderName), {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw mapUploadStatus(res.status, body.slice(0, 500));
  }
  return res.json().catch(() => ({}));
}

export function writeErrorResponse(error: unknown): Response {
  if (error instanceof OsfWriteError) {
    return Response.json({ error: error.message, code: error.code }, { status: error.status });
  }
  return Response.json({ error: error instanceof Error ? error.message : String(error), code: "upstream" }, { status: 500 });
}
