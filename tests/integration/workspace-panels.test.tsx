/**
 * Homepage workspace redesign (user request 2026-08-04): remove the permanently
 * hardcoded example projects, and present recents as an organised table with
 * useful information (when last opened, how often).
 *
 * These tests pin the behaviour that is easy to regress:
 *  - visit stats actually reach the screen (not silently dropped),
 *  - legacy entries with no stats render "—" rather than a fabricated date,
 *  - the examples appear ONLY on a truly empty workspace,
 *  - sorting and filtering operate on the real data.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import { PinnedRecentPanels } from "@/components/PinnedRecentPanels";
import { _resetForTests } from "@/lib/favorites";
import { setPref } from "@/lib/prefs";

const NOW = Date.parse("2026-08-04T12:00:00Z");

beforeEach(() => {
  _resetForTests();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

function seedRecents(entries: unknown[]) {
  setPref("favorites.recents", entries);
}

describe("workspace — empty state", () => {
  it("shows example projects only when there is no history at all", async () => {
    render(<PinnedRecentPanels showPinned />);
    expect(await screen.findByText("Many Labs 2")).toBeInTheDocument();
    expect(screen.getByText("Reproducibility Project: Psychology")).toBeInTheDocument();
  });

  it("hides the examples as soon as the user has their own history", async () => {
    seedRecents([
      { id: "abc12", title: "My Real Project", kind: "project", lastViewed: NOW - 60_000, visits: 3 },
    ]);
    render(<PinnedRecentPanels showPinned />);
    expect(await screen.findByText("My Real Project")).toBeInTheDocument();
    expect(screen.queryByText("Many Labs 2")).toBeNull();
    expect(screen.queryByText(/New here\? Try an example/)).toBeNull();
  });
});

describe("workspace — visit statistics reach the screen", () => {
  it("renders last-opened and visit count for each row", async () => {
    seedRecents([
      { id: "abc12", title: "Alpha", kind: "project", lastViewed: NOW - 3 * 3_600_000, visits: 7 },
    ]);
    render(<PinnedRecentPanels showPinned={false} />);

    const row = (await screen.findByText("Alpha")).closest("tr");
    expect(row).toBeTruthy();
    expect(within(row!).getByText("3h ago")).toBeInTheDocument();
    expect(within(row!).getByText("7")).toBeInTheDocument();
  });

  it("renders an em dash (not a 1970 date) for legacy entries with no stats", async () => {
    seedRecents([{ id: "old99", title: "Legacy", kind: "project" }]);
    render(<PinnedRecentPanels showPinned={false} />);

    const row = (await screen.findByText("Legacy")).closest("tr");
    expect(row).toBeTruthy();
    // Two "—" cells: last-opened and visits.
    expect(within(row!).getAllByText("—")).toHaveLength(2);
    expect(within(row!).queryByText(/1970|ago/)).toBeNull();
  });
});

describe("workspace — sorting and filtering", () => {
  const seeded = [
    { id: "a1", title: "Zebra study", kind: "project", lastViewed: NOW - 1_000, visits: 1 },
    { id: "b2", title: "Alpha study", kind: "project", lastViewed: NOW - 90_000_000, visits: 50 },
  ];

  it("defaults to most-recently-opened first", async () => {
    seedRecents(seeded);
    render(<PinnedRecentPanels showPinned={false} />);
    const rows = await screen.findAllByRole("row");
    // rows[0] is the header.
    expect(within(rows[1]!).getByText("Zebra study")).toBeInTheDocument();
  });

  it("re-orders by visit count when 'Most visited' is chosen", async () => {
    seedRecents(seeded);
    render(<PinnedRecentPanels showPinned={false} />);
    await screen.findByText("Zebra study");

    fireEvent.change(screen.getByLabelText(/sort workspace items/i), { target: { value: "visits" } });

    const rows = screen.getAllByRole("row");
    expect(within(rows[1]!).getByText("Alpha study")).toBeInTheDocument();
  });

  it("filters by title text", async () => {
    seedRecents(seeded);
    render(<PinnedRecentPanels showPinned={false} />);
    await screen.findByText("Zebra study");

    fireEvent.change(screen.getByLabelText(/filter workspace items/i), { target: { value: "alpha" } });

    expect(screen.getByText("Alpha study")).toBeInTheDocument();
    expect(screen.queryByText("Zebra study")).toBeNull();
  });
});

describe("workspace — file/folder location", () => {
  it("shows the containing project and folder path for a file", async () => {
    seedRecents([
      {
        id: "3kmr9/osfstorage/PCIRR Stage 1/Figures/test.txt",
        title: "test.txt",
        kind: "file",
        lastViewed: NOW - 1_000,
        visits: 1,
      },
    ]);
    render(<PinnedRecentPanels showPinned={false} />);

    fireEvent.click(await screen.findByRole("tab", { name: /files/i }));

    const row = (await screen.findByText("test.txt")).closest("tr");
    expect(within(row!).getByText("3kmr9 › PCIRR Stage 1 › Figures")).toBeInTheDocument();
  });

  it("links a deep file to its viewer route", async () => {
    seedRecents([
      {
        id: "3kmr9/osfstorage/PCIRR Stage 1/test.txt",
        title: "test.txt",
        kind: "file",
        lastViewed: NOW,
        visits: 1,
      },
    ]);
    render(<PinnedRecentPanels showPinned={false} />);
    fireEvent.click(await screen.findByRole("tab", { name: /files/i }));

    expect(screen.getByRole("link", { name: /test\.txt/ })).toHaveAttribute(
      "href",
      "/3kmr9/files/view/osfstorage/PCIRR Stage 1/test.txt",
    );
  });
});
