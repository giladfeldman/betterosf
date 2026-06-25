"use client";

import { useRouter } from "next/navigation";
import { NewFolderControl } from "./NewFolderControl";
import type { TreeUploadTarget } from "./tree-types";

export function FolderViewNewFolder({ target }: { target: TreeUploadTarget }) {
  const router = useRouter();
  return <NewFolderControl target={target} onCreated={() => router.refresh()} />;
}
