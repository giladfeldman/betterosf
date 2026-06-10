import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NewFolderControl } from "@/components/NewFolderControl";
import type { TreeUploadTarget } from "@/components/UnifiedTreeNode";

const target: TreeUploadTarget = {
  guid: "abc12",
  provider: "osfstorage",
  path: "/",
  name: "OSF Storage",
  listingUrl: "https://api.osf.io/v2/nodes/abc12/files/osfstorage/",
  uploadUrl: "https://files.osf.io/v1/resources/abc12/providers/osfstorage/",
  newFolderUrl: "https://files.osf.io/v1/resources/abc12/providers/osfstorage/",
};

describe("NewFolderControl", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("reveals an input when '+ Folder' is clicked, then posts the folder-create payload and calls onCreated", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const onCreated = vi.fn();

    render(<NewFolderControl target={target} onCreated={onCreated} />);

    fireEvent.click(screen.getByRole("button", { name: /new folder in/i }));
    const input = screen.getByRole("textbox", { name: /new folder name/i });
    fireEvent.change(input, { target: { value: "data" } });
    fireEvent.click(screen.getByRole("button", { name: /^create$/i }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(target));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/files/abc12/folder-create",
      expect.objectContaining({ method: "POST" })
    );
    const firstCall = fetchMock.mock.calls[0];
    expect(firstCall).toBeDefined();
    const body = JSON.parse((firstCall![1] as RequestInit).body as string);
    expect(body).toMatchObject({ provider: "osfstorage", path: "/", name: "data", newFolderUrl: target.newFolderUrl });
  });

  it("shows the server error message on failure and does not call onCreated", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: '"data" already exists in this folder.' }), { status: 409 })
    );
    const onCreated = vi.fn();
    render(<NewFolderControl target={target} onCreated={onCreated} />);

    fireEvent.click(screen.getByRole("button", { name: /new folder in/i }));
    fireEvent.change(screen.getByRole("textbox", { name: /new folder name/i }), { target: { value: "data" } });
    fireEvent.click(screen.getByRole("button", { name: /^create$/i }));

    await waitFor(() => expect(screen.getByText(/already exists/i)).toBeInTheDocument());
    expect(onCreated).not.toHaveBeenCalled();
  });
});
