"use client";

import type { ReactNode } from "react";
import type { TreeUploadTarget } from "./tree-types";

export const OPEN_UPLOAD_EVENT = "betterosf:open-upload";

export function UploadFilesButton({
  guid,
  target,
  children = "Upload files",
  className,
}: {
  guid: string;
  target?: TreeUploadTarget;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => {
        window.dispatchEvent(
          new CustomEvent(OPEN_UPLOAD_EVENT, {
            detail: { guid, target },
          })
        );
      }}
      className={
        className ??
        "rounded border border-blue-300 bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-800 hover:bg-blue-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-200 dark:hover:bg-blue-900"
      }
    >
      {children}
    </button>
  );
}
