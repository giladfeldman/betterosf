type Reason = "wrong-provider" | "missing-folder" | "missing-file" | "upstream-error";

const MESSAGES: Record<Reason, { title: string; body: string }> = {
  "wrong-provider": {
    title: "Storage provider not found",
    body: "This project doesn't have the storage provider you asked for. Use the tree to pick a different one.",
  },
  "missing-folder": {
    title: "Folder not found",
    body: "A folder along this path doesn't exist any more. It may have been renamed or deleted on OSF.",
  },
  "missing-file": {
    title: "File not found",
    body: "The project exists but this specific file isn't there. It may have been renamed or deleted on OSF.",
  },
  "upstream-error": {
    title: "OSF didn't return this file",
    body: "We reached OSF but the file lookup failed. This can happen for permission-restricted files or transient OSF errors. Try again or browse via the tree.",
  },
};

export function FileMissing({
  reason,
  guid,
  attemptedPath,
}: {
  reason: Reason;
  guid: string;
  attemptedPath: string;
}) {
  const m = MESSAGES[reason];
  return (
    <div className="border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40 rounded p-4 max-w-2xl">
      <h2 className="text-lg font-semibold mb-1">{m.title}</h2>
      <p className="text-sm text-neutral-700 dark:text-neutral-300 mb-3">{m.body}</p>
      <p className="text-xs font-mono break-all text-neutral-500 dark:text-neutral-400 mb-3">{attemptedPath}</p>
      <div className="flex gap-3 text-sm">
        <a className="underline" href={`/${guid}/files`}>Browse files</a>
        <a className="underline" href={`/${guid}`}>Project overview</a>
      </div>
    </div>
  );
}
