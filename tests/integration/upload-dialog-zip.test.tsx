import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import JSZip from "jszip";
import { UploadDialog } from "@/components/UploadDialog";
import type { TreeUploadTarget } from "@/components/UnifiedTreeNode";

const target: TreeUploadTarget = {
  guid: "abc12",
  provider: "osfstorage",
  path: "/",
  name: "OSF Storage",
  nodeTitle: "My Project",
  sourceKind: "project",
  listingUrl: "https://api.osf.io/v2/nodes/abc12/files/osfstorage/",
  uploadUrl: "https://files.osf.io/v1/resources/abc12/providers/osfstorage/",
  newFolderUrl: "https://files.osf.io/v1/resources/abc12/providers/osfstorage/",
};

async function zipFile(): Promise<File> {
  const zip = new JSZip();
  zip.file("readme.txt", "top-level");
  zip.file("data/raw.csv", "a,b,c");
  zip.file("__MACOSX/junk", "junk");
  const blob = await zip.generateAsync({ type: "blob" });
  return new File([blob], "bundle.zip", { type: "application/zip" });
}

describe("UploadDialog — ZIP tab", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/osf/write-status")) {
        return Response.json({ signedIn: true, canWrite: true, needsReconnect: false, expiresAt: null, writeScope: "osf.full_write" });
      }
      throw new Error(`unexpected fetch in test: ${url}`);
    });
  });

  it("extracts a chosen ZIP and shows the folder tree for confirmation", async () => {
    render(<UploadDialog target={target} onClose={() => {}} onComplete={() => {}} />);

    // Wait for the write-capable UI (tabs) to appear.
    const zipTab = await screen.findByRole("tab", { name: /upload a zip/i });
    fireEvent.click(zipTab);

    const input = screen.getByLabelText(/choose a zip file/i);
    fireEvent.change(input, { target: { files: [await zipFile()] } });

    // The extracted ZIP drives the existing confirmation preview.
    await waitFor(() => expect(screen.getByText(/extracted/i)).toBeInTheDocument());
    expect(screen.getByText("bundle.zip")).toBeInTheDocument();
    // Both real files appear with their relative paths; junk is filtered out.
    expect(screen.getByText("readme.txt")).toBeInTheDocument();
    expect(screen.getByText("data/raw.csv")).toBeInTheDocument();
    expect(screen.getByText(/1 system file.*skipped/i)).toBeInTheDocument();
    // The upload action reflects 2 selectable files.
    expect(screen.getByRole("button", { name: /upload 2 files/i })).toBeInTheDocument();
  });
});
