/**
 * d-3812c6 (class: unknown is not zero). The Zenodo transfer panel caught a failed read of
 * the browser's saved transfer jobs as "nothing to resume", so a user with an unfinished
 * transfer was offered a fresh start and left half-filled drafts behind in Zenodo. A failed
 * read must say "could not read saved progress", never look like no saved job.
 *
 * Both reads are covered: the page-load list (rendered) and the after-failure re-read
 * (through the shared helper the panel uses for both).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { PlanResponse } from "@/components/transition/plan-types";

const listLocalJobs = vi.fn();
const getLocalJob = vi.fn();
vi.mock("@/lib/transition/ledger", () => ({
  listLocalJobs: () => listLocalJobs(),
  getLocalJob: (id: string) => getLocalJob(id),
  createBrowserLedger: vi.fn(),
}));

vi.mock("@/lib/transition/stage-opfs", async (orig) => ({
  ...(await orig<typeof import("@/lib/transition/stage-opfs")>()),
  opfsAvailable: () => true,
}));

const plan = {
  guid: "abcde",
  title: "T",
  description: "",
  category: "project",
  tags: [],
  dateCreated: "2020-01-01T00:00:00Z",
  dateModified: "2020-01-01T00:00:00Z",
  osfUrl: "https://osf.io/abcde/",
  doi: null,
  license: null,
  contributors: [],
  files: [],
  wikis: [],
  addonProviders: [],
} as unknown as PlanResponse;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ connected: true, site: "sandbox.zenodo.org", env: "sandbox", expiresAt: null })),
  );
});

describe("a failed read of saved transfer progress is shown, not read as 'nothing to resume'", () => {
  it("page load: listLocalJobs rejects -> the panel says it could not read saved progress", async () => {
    listLocalJobs.mockRejectedValue(new Error("IndexedDB blocked"));
    const { ZenodoTransferPanel } = await import("@/components/transition/ZenodoTransferPanel");
    render(<ZenodoTransferPanel plan={plan} appVersion="test" onSwitchToDownload={() => {}} />);
    expect(await screen.findByText(/could not read the saved progress/i)).toBeTruthy();
  });

  it("control: an empty job list shows no such notice and no resume offer", async () => {
    listLocalJobs.mockResolvedValue([]);
    const { ZenodoTransferPanel } = await import("@/components/transition/ZenodoTransferPanel");
    render(<ZenodoTransferPanel plan={plan} appVersion="test" onSwitchToDownload={() => {}} />);
    await screen.findByText(/What is this deposit/i);
    expect(screen.queryByText(/could not read the saved progress/i)).toBeNull();
    expect(screen.queryByText(/Continue that transfer/i)).toBeNull();
  });

  it("control: a running job for this project is offered for resume", async () => {
    listLocalJobs.mockResolvedValue([{ jobId: "j1", guid: "abcde", status: "running", records: [{ recordId: "r1" }] }]);
    const { ZenodoTransferPanel } = await import("@/components/transition/ZenodoTransferPanel");
    render(<ZenodoTransferPanel plan={plan} appVersion="test" onSwitchToDownload={() => {}} />);
    expect(await screen.findByText(/Continue that transfer/i)).toBeTruthy();
  });

  it("after-failure re-read: getLocalJob rejects -> 'unreadable', not 'none'", async () => {
    const { savedJobForResume } = await import("@/lib/transition/resume-offer");
    getLocalJob.mockRejectedValue(new Error("IndexedDB blocked"));
    const r = await savedJobForResume("j1", (id) => getLocalJob(id));
    expect(r.kind).toBe("unreadable");
    getLocalJob.mockResolvedValue(null);
    expect((await savedJobForResume("j1", (id) => getLocalJob(id))).kind).toBe("none");
  });

  it("unreadable progress keeps Start locked until the user says they checked Zenodo", async () => {
    listLocalJobs.mockRejectedValue(new Error("IndexedDB blocked"));
    const withFiles = {
      ...plan,
      files: [{ osfFileId: "f1", path: "osfstorage/a.csv", size: 3, md5: null, sha256: "x", downloadUrl: "u" }],
    } as unknown as PlanResponse;
    const { ZenodoTransferPanel } = await import("@/components/transition/ZenodoTransferPanel");
    render(<ZenodoTransferPanel plan={withFiles} appVersion="test" onSwitchToDownload={() => {}} />);
    await screen.findByText(/could not read the saved progress/i);
    fireEvent.click(screen.getByLabelText(/I have the right to deposit/i));
    const startButton = screen.getByRole("button", { name: /Start transfer/i }) as HTMLButtonElement;
    expect(startButton.disabled).toBe(true);
    fireEvent.click(screen.getByLabelText(/I checked my Zenodo uploads/i));
    expect(startButton.disabled).toBe(false);
  });

  // Cross-model review 2026-11-19: files OSF lists without a size are not transferred, and a
  // project whose files were ALL unsized read "This project has no files" before Start.
  it("all files unsized: says OSF reported no size, never 'this project has no files'", async () => {
    listLocalJobs.mockResolvedValue([]);
    const unsizedOnly = {
      ...plan,
      files: [],
      unsizedFiles: [{ osfFileId: "f1", path: "dropbox/data.csv" }],
    } as unknown as PlanResponse;
    const { ZenodoTransferPanel } = await import("@/components/transition/ZenodoTransferPanel");
    render(<ZenodoTransferPanel plan={unsizedOnly} appVersion="test" onSwitchToDownload={() => {}} />);
    expect(await screen.findByText(/did not report a size for 1 file/i)).toBeTruthy();
    expect(screen.getByText("dropbox/data.csv")).toBeTruthy();
    expect(screen.queryByText(/This project has no files/i)).toBeNull();
  });
});

