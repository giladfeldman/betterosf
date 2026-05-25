import * as React from "react";

/**
 * OSF registration schema responses are arbitrary JSON-shaped values keyed by the
 * registration schema. The most interesting non-scalar shape is an "uploaded file"
 * object (the OSF uploader widget), which has `file_name` / `file_id` / etc. This
 * helper centralizes the rendering logic so it can be unit-tested independently of
 * the page component.
 */

export type UploadedFile = {
  file_id?: string;
  file_name?: string;
  file_urls?: { html?: string; download?: string };
  file_hashes?: { sha256?: string };
  sha256?: string;
};

export function isUploadedFile(v: unknown): v is UploadedFile {
  return typeof v === "object" && v !== null && ("file_name" in v || "file_id" in v);
}

export function renderScalar(v: unknown): React.ReactNode {
  if (v === null || v === undefined) return <span className="text-neutral-500">—</span>;
  if (typeof v === "string" && v.length > 200) return <p className="whitespace-pre-wrap">{v}</p>;
  if (typeof v === "boolean") return <span>{v ? "Yes" : "No"}</span>;
  if (typeof v === "number" || typeof v === "string") return <span>{String(v)}</span>;
  return (
    <pre className="text-xs bg-neutral-100 dark:bg-neutral-900 rounded p-2 overflow-auto whitespace-pre-wrap">
      {JSON.stringify(v, null, 2)}
    </pre>
  );
}

export function renderUploadedFile(file: UploadedFile, key: React.Key) {
  const name = file.file_name ?? file.file_id ?? "unnamed";
  const href = file.file_urls?.html ?? file.file_urls?.download;
  return (
    <li key={key} className="font-mono-files">
      <span aria-hidden="true">📄</span>{" "}
      {href ? <a href={href} className="text-blue-600 hover:underline">{name}</a> : <span>{name}</span>}
    </li>
  );
}

export function renderValue(v: unknown): React.ReactNode {
  if (v === null || v === undefined) return <span className="text-neutral-500">—</span>;

  if (Array.isArray(v)) {
    if (v.length > 0 && v.every(isUploadedFile)) {
      return <ul className="space-y-0.5">{v.map((f, i) => renderUploadedFile(f as UploadedFile, i))}</ul>;
    }
    return (
      <ul className="list-disc list-inside space-y-0.5">
        {v.map((x, i) => (
          <li key={i}>{renderScalar(x)}</li>
        ))}
      </ul>
    );
  }

  if (isUploadedFile(v)) {
    return <ul className="space-y-0.5">{renderUploadedFile(v, 0)}</ul>;
  }

  return renderScalar(v);
}
