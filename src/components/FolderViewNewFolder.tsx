"use client";

import { useRouter } from "next/navigation";
import { NewFolderControl } from "./NewFolderControl";
import type { TreeUploadTarget } from "./UnifiedTreeNode";

export function FolderViewNewFolder({ target }: { target: TreeUploadTarget }) {
  const router = useRouter();
  return <NewFolderControl target={target} onCreated={() => router.refresh()} />;
}
