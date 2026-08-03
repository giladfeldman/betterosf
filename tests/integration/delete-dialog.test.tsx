import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { DeleteDialog } from "@/components/DeleteDialog";
import type { TreeSelectionPayload } from "@/components/tree-types";

vi.mock("next-auth/react", () => ({ signIn: vi.fn() }));

// The backup subsystem is exercised in its own unit tests; here we stub it so the tests
// isolate the CONFIRM GATING, which is the safety-critical behaviour of this component.
vi.mock("@/lib/backup/capture", async (orig) => {
  const actual = await orig<typeof import("@/lib/backup/capture")>();
  return {
    ...actual,
    planCapture: vi.fn(),
    captureBackup: vi.fn(),
  };
});
vi.mock("@/lib/backup/idb", async (orig) => {
  const actual = await orig<typeof import("@/lib/backup/idb")>();
  return {
    ...actual,
    idbAvailable: () => true,
    likelyFits: vi.fn().mockResolvedValue(true),
    saveBackup: vi.fn().mockResolvedValue({ ok: true, evicted: [], persisted: true }),
    attachDeleteSummary: vi.fn().mockResolvedValue(undefined),
  };
});
vi.mock("@/lib/backup/download", () => ({ downloadBlob: vi.fn() }));

import { planCapture, captureBackup } from "@/lib/backup/capture";

const WB = "https://files.osf.io/v1/resources/abc12/providers/osfstorage";
const LISTING = "https://api.osf.io/v2/nodes/abc12/files/osfstorage/";

function fileItem(name = "data.csv"): TreeSelectionPayload {
  return {
    kind: "file",
    guid: "abc12",
    provider: "osfstorage",
    path: `/${name}`,
    name,
    downloadUrl: `${WB}/${name}`,
    deleteUrl: `${WB}/5f1a`,
    parentListingUrl: LISTING,
  };
}

function folderItem(name = "raw"): TreeSelectionPayload {
  return {
    kind: "folder",
    guid: "abc12",
    provider: "osfstorage",
    path: `/${name}/`,
    name,
    deleteUrl: `${WB}/5f1b/`,
    parentListingUrl: LISTING,
  };
}

function mockPlan(fileCount: number, totalBytes = 1024) {
  (planCapture as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    files: Array.from({ length: fileCount }, (_, i) => ({
      archivePath: `f${i}.csv`,
      name: `f${i}.csv`,
      size: 10,
      downloadUrl: `${WB}/f${i}`,
    })),
    totalBytes,
    tooLarge: false,
  });
}

function mockCapture(status: "complete" | "incomplete", missing: { path: string; reason: string }[] = []) {
  (captureBackup as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    blob: new Blob(["zip"]),
    items: [{ kind: "file", path: "f0.csv", name: "f0.csv", size: 10, sha256: "abc" }],
    missing,
    totalBytes: 10,
    status,
  });
}

async function openAndBackup(items: TreeSelectionPayload[]) {
  const onDeleted = vi.fn();
  render(
    <DeleteDialog guid="abc12" projectTitle="Test project" items={items} onClose={() => {}} onDeleted={onDeleted} />
  );
  await waitFor(() => expect(screen.getByRole("button", { name: /back up these files first/i })).toBeTruthy());
  fireEvent.click(screen.getByRole("button", { name: /back up these files first/i }));
  return onDeleted;
}

function confirmButton(): HTMLButtonElement {
  return screen.getByRole("button", { name: /delete permanently/i }) as HTMLButtonElement;
}

describe("DeleteDialog", () => {
  beforeEach(() => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      if (String(input).includes("write-status")) {
        return new Response(JSON.stringify({ signedIn: true, canWrite: true, needsReconnect: false }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true, deleted: 1, alreadyGone: 0, failed: 0, results: [] }), { status: 200 });
    });
    mockPlan(1);
    mockCapture("complete");
  });

  afterEach(() => {
    // NOT restoreAllMocks(): that strips the implementations off the vi.mock module
    // factories above, so every test after the first would get `undefined` from
    // planCapture. Only the fetch spy needs unwinding.
    vi.mocked(globalThis.fetch).mockRestore?.();
  });

  it("always warns that OSF has no trash", async () => {
    render(<DeleteDialog guid="abc12" projectTitle="T" items={[fileItem()]} onClose={() => {}} onDeleted={() => {}} />);
    await waitFor(() => expect(screen.getByText(/OSF has no trash/i)).toBeTruthy());
  });

  it("keeps confirm disabled until the exact filename is typed", async () => {
    await openAndBackup([fileItem()]);
    await waitFor(() => expect(confirmButton()).toBeTruthy());
    expect(confirmButton().disabled).toBe(true);

    fireEvent.change(screen.getByLabelText(/confirmation phrase/i), { target: { value: "data.cs" } });
    await waitFor(() => expect(confirmButton().disabled).toBe(true));

    fireEvent.change(screen.getByLabelText(/confirmation phrase/i), { target: { value: "data.csv" } });
    await waitFor(() => expect(confirmButton().disabled).toBe(false));
  });

  it("requires BOTH the phrase and the checkbox for a bulk delete", async () => {
    mockPlan(2);
    await openAndBackup([fileItem("a.csv"), fileItem("b.csv")]);
    await waitFor(() => expect(confirmButton()).toBeTruthy());

    fireEvent.change(screen.getByLabelText(/confirmation phrase/i), { target: { value: "delete 2 items permanently" } });
    // Phrase alone is not enough — the second gate is the whole point for bulk.
    // Settle first, so this asserts the gate rather than an un-flushed render.
    await new Promise((r) => setTimeout(r, 50));
    expect(confirmButton().disabled).toBe(true);

    fireEvent.click(screen.getByRole("checkbox"));
    await waitFor(() => expect(confirmButton().disabled).toBe(false));
  });

  it("never enables confirm when the backup is incomplete, no matter what is typed", async () => {
    mockCapture("incomplete", [{ path: "lost.csv", reason: "HTTP 500" }]);
    await openAndBackup([fileItem()]);
    await waitFor(() => expect(screen.getByText(/backup is incomplete/i)).toBeTruthy());
    // The confirm section is not even rendered — deletion is hard-blocked.
    expect(screen.queryByRole("button", { name: /delete permanently/i })).toBeNull();
  });

  it("blocks confirm until a mandatory backup download is taken", async () => {
    // A folder selection always makes the download mandatory.
    mockPlan(3);
    await openAndBackup([folderItem("raw")]);
    await waitFor(() => expect(screen.getByText(/must download this backup/i)).toBeTruthy());

    fireEvent.change(screen.getByLabelText(/confirmation phrase/i), {
      target: { value: "delete raw and 3 items permanently" },
    });
    fireEvent.click(screen.getByRole("checkbox"));
    // Phrase + checkbox satisfied, but the ZIP has not been taken off the device.
    expect(confirmButton().disabled).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: /download backup zip \(required\)/i }));
    await waitFor(() => expect(confirmButton().disabled).toBe(false));
  });

  it("is honest that it cannot verify the download completed", async () => {
    mockPlan(3);
    await openAndBackup([folderItem("raw")]);
    await waitFor(() => expect(screen.getByRole("button", { name: /download backup zip/i })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /download backup zip/i }));
    await waitFor(() => expect(screen.getByText(/cannot confirm it finished/i)).toBeTruthy());
  });

  it("shows the terms and states the typed phrase is a signature", async () => {
    await openAndBackup([fileItem()]);
    // Appears both in the collapsed clause list and in the signature paragraph — both
    // are intentional, so assert at least one rather than exactly one.
    await waitFor(() => expect(screen.getAllByText(/electronic signature/i).length).toBeGreaterThan(0));
    expect(screen.getByText(/Terms that apply to this deletion/i)).toBeTruthy();
  });

  describe("empty selection (nothing to back up)", () => {
    it("skips the backup stage entirely for an empty folder", async () => {
      (planCapture as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ files: [], totalBytes: 0, tooLarge: false });
      render(<DeleteDialog guid="abc12" projectTitle="T" items={[folderItem("test")]} onClose={() => {}} onDeleted={() => {}} />);
      await waitFor(() => expect(screen.getByRole("button", { name: /^continue$/i })).toBeTruthy());
      // No "back up these files first" — there is nothing to copy.
      expect(screen.queryByRole("button", { name: /back up these files/i })).toBeNull();
      expect(screen.getByText(/folder is empty, so there is nothing to back up/i)).toBeTruthy();
    });

    it("does not warn about hidden contents when the folder is empty", async () => {
      (planCapture as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ files: [], totalBytes: 0, tooLarge: false });
      render(<DeleteDialog guid="abc12" projectTitle="T" items={[folderItem("test")]} onClose={() => {}} onDeleted={() => {}} />);
      await waitFor(() => expect(screen.getByRole("button", { name: /^continue$/i })).toBeTruthy());
      expect(screen.queryByText(/may cover more than you can see/i)).toBeNull();
    });

    it("never demands a download of an empty archive", async () => {
      (planCapture as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ files: [], totalBytes: 0, tooLarge: false });
      render(<DeleteDialog guid="abc12" projectTitle="T" items={[folderItem("test")]} onClose={() => {}} onDeleted={() => {}} />);
      await waitFor(() => expect(screen.getByRole("button", { name: /^continue$/i })).toBeTruthy());
      fireEvent.click(screen.getByRole("button", { name: /^continue$/i }));
      await waitFor(() => expect(confirmButton()).toBeTruthy());
      expect(screen.queryByText(/must download this backup/i)).toBeNull();
      expect(screen.queryByRole("button", { name: /download backup zip/i })).toBeNull();
    });

    it("still requires the typed phrase and checkbox for an empty folder", async () => {
      (planCapture as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ files: [], totalBytes: 0, tooLarge: false });
      render(<DeleteDialog guid="abc12" projectTitle="T" items={[folderItem("test")]} onClose={() => {}} onDeleted={() => {}} />);
      await waitFor(() => expect(screen.getByRole("button", { name: /^continue$/i })).toBeTruthy());
      fireEvent.click(screen.getByRole("button", { name: /^continue$/i }));
      await waitFor(() => expect(confirmButton()).toBeTruthy());
      // Skipping the backup must NOT skip consent — it is still an irreversible delete.
      expect(confirmButton().disabled).toBe(true);
      fireEvent.change(screen.getByLabelText(/confirmation phrase/i), {
        target: { value: "delete test and 0 items permanently" },
      });
      fireEvent.click(screen.getByRole("checkbox"));
      await waitFor(() => expect(confirmButton().disabled).toBe(false));
    });
  });

  it("refuses to proceed when the selection is too large to back up", async () => {
    (planCapture as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ files: [], totalBytes: 0, tooLarge: true });
    render(<DeleteDialog guid="abc12" projectTitle="T" items={[folderItem()]} onClose={() => {}} onDeleted={() => {}} />);
    await waitFor(() => expect(screen.getByText(/too large for BetterOSF to back up safely/i)).toBeTruthy());
    expect(screen.queryByRole("button", { name: /back up these files first/i })).toBeNull();
  });

  it("offers reconnect instead of deleting when the session is read-only", async () => {
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (input: unknown) => {
      if (String(input).includes("write-status")) {
        return new Response(JSON.stringify({ signedIn: true, canWrite: false, needsReconnect: true }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    });
    render(<DeleteDialog guid="abc12" projectTitle="T" items={[fileItem()]} onClose={() => {}} onDeleted={() => {}} />);
    await waitFor(() => expect(screen.getByRole("button", { name: /reconnect osf/i })).toBeTruthy());
  });

  it("closes on Escape before a delete has started", async () => {
    const onClose = vi.fn();
    render(<DeleteDialog guid="abc12" projectTitle="T" items={[fileItem()]} onClose={onClose} onDeleted={() => {}} />);
    await waitFor(() => expect(screen.getByRole("dialog")).toBeTruthy());
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("reports per-item outcomes rather than one opaque status", async () => {
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (input: unknown) => {
      if (String(input).includes("write-status")) {
        return new Response(JSON.stringify({ signedIn: true, canWrite: true, needsReconnect: false }), { status: 200 });
      }
      return new Response(
        JSON.stringify({
          ok: false,
          deleted: 1,
          alreadyGone: 0,
          failed: 1,
          results: [
            { path: "/a.csv", name: "a.csv", status: "deleted" },
            { path: "/b.csv", name: "b.csv", status: "failed", message: "Permission denied" },
          ],
        }),
        { status: 200 }
      );
    });
    mockPlan(2);
    await openAndBackup([fileItem("a.csv"), fileItem("b.csv")]);
    await waitFor(() => expect(confirmButton()).toBeTruthy());
    fireEvent.change(screen.getByLabelText(/confirmation phrase/i), { target: { value: "delete 2 items permanently" } });
    fireEvent.click(screen.getByRole("checkbox"));
    await waitFor(() => expect(confirmButton().disabled).toBe(false));
    fireEvent.click(confirmButton());

    await waitFor(() => expect(screen.getByText(/Permission denied/)).toBeTruthy());
    // Both outcomes are shown individually — never collapsed into one status.
    expect(screen.getByText("Deleted")).toBeTruthy();
    expect(screen.getByText("Failed")).toBeTruthy();
  });
});
