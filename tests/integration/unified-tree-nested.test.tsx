/**
 * Nested components in the navigator (2026-11-16).
 *
 * The finding: on df9tj (100 components) the tree showed no Components section at all —
 * OSF took 14-21 s to list them and our 8 s timeout turned that into "0 components".
 * The fix lists components fast (sparse fieldset) and lets the user open a component to
 * see ITS components, recursively, each loaded only when opened.
 */
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { UnifiedTree } from "@/components/UnifiedTree";
import type { ComponentTree } from "@/lib/osf/full-tree";

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: (opts: { count: number }) => ({
    getTotalSize: () => opts.count * 28,
    getVirtualItems: () =>
      Array.from({ length: opts.count }).map((_, i) => ({ index: i, start: i * 28, size: 28, key: i })),
    measureElement: () => {},
  }),
}));

function comp(guid: string, title: string, childCount?: number, skipped = true): ComponentTree {
  return { guid, title, category: "", isPublic: true, skeleton: [], skipped, ...(childCount !== undefined ? { childCount } : {}) };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

let calls: string[] = [];
let fetchSpy: { mockRestore: () => void } | undefined;

beforeEach(() => {
  localStorage.clear();
  calls = [];
});
afterEach(() => fetchSpy?.mockRestore());

function mockFetch(routes: Record<string, () => Response>) {
  fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
    const u = String(url);
    calls.push(u);
    for (const [frag, make] of Object.entries(routes)) if (u.includes(frag)) return make();
    if (u.includes("/api/files/") && u.includes("/skeleton")) return json({ skeleton: [] });
    if (u.includes("/api/osf/write-status")) return json({ canWrite: false });
    return json({ entries: [] });
  });
}

function renderTree(componentTrees: ComponentTree[], extra: Partial<Parameters<typeof UnifiedTree>[0]> = {}) {
  return render(
    <UnifiedTree
      guid="root1"
      rootTitle="Root"
      skeleton={[]}
      components={componentTrees.map((c) => ({ id: c.guid, title: c.title })) as never}
      componentTrees={componentTrees}
      linkedNodes={[]}
      registrations={[]}
      {...extra}
    />
  );
}

function toggleRow(label: string) {
  const row = screen.getByText(label).closest('[role="treeitem"]')!;
  fireEvent.click(row.querySelector('button[aria-label="Expand"], button[aria-label="Collapse"]')!);
}

describe("UnifiedTree nested components", () => {
  it("opening a component lists its components; opening one of those lists ITS components", async () => {
    mockFetch({
      "/api/osf/children/sub01": () => json({ children: [comp("deep1", "Deep component", 0)] }),
      "/api/osf/children/top01": () => json({ children: [comp("sub01", "Sub component", 1), comp("sub02", "Other sub", 0)] }),
    });
    // 11 top-level components: above the auto-expand cap, so all start closed.
    const tops = [comp("top01", "Top with kids", 2), ...Array.from({ length: 10 }, (_, i) => comp(`plain${i}`, `Plain ${i}`, 0))];
    renderTree(tops);

    expect(screen.getByText("Top with kids")).toBeInTheDocument();
    expect(screen.queryByText("Sub component")).not.toBeInTheDocument();
    // The count of components inside is visible before opening.
    expect(screen.getByLabelText("2 components inside")).toBeInTheDocument();

    toggleRow("Top with kids");
    await waitFor(() => expect(screen.getByText("Sub component")).toBeInTheDocument());
    expect(screen.getByText("Other sub")).toBeInTheDocument();

    toggleRow("Sub component");
    await waitFor(() => expect(screen.getByText("Deep component")).toBeInTheDocument());

    // Nesting is visible as depth: deeper rows sit one aria-level further in.
    const level = (t: string) => Number(screen.getByText(t).closest('[role="treeitem"]')!.getAttribute("aria-level"));
    expect(level("Sub component")).toBe(level("Top with kids") + 1);
    expect(level("Deep component")).toBe(level("Sub component") + 1);
  });

  it("a component with a known 0 components never asks for its component list", async () => {
    mockFetch({});
    renderTree([comp("zero1", "No kids", 0)]);
    // 1 component: auto-expanded and indexed in the background, as before.
    await waitFor(() => expect(calls.some((u) => u.includes("/api/files/zero1/skeleton"))).toBe(true));
    expect(calls.some((u) => u.includes("/api/osf/children/zero1"))).toBe(false);
  });

  it("100 components: no folder loads and no component-list loads until the user opens one", async () => {
    mockFetch({});
    const tops = Array.from({ length: 100 }, (_, i) => comp(`c${String(i).padStart(3, "0")}`, `Talk ${i}`, 1));
    renderTree(tops);
    expect(screen.getByText("Components (100)")).toBeInTheDocument();
    expect(screen.getByText("Talk 99")).toBeInTheDocument();
    // Give effects a chance to run, then check nothing per-component was fetched.
    await new Promise((r) => setTimeout(r, 50));
    expect(calls.filter((u) => u.includes("/skeleton") || u.includes("/api/osf/children/"))).toEqual([]);

    toggleRow("Talk 5");
    await waitFor(() => expect(calls.some((u) => u.includes("/api/files/c005/skeleton"))).toBe(true));
    await waitFor(() => expect(calls.some((u) => u.includes("/api/osf/children/c005"))).toBe(true));
    // Still only the one that was opened.
    expect(calls.filter((u) => u.includes("/skeleton")).length).toBe(1);
  });

  it("a failed component list shows Retry, and Retry fetches again", async () => {
    let n = 0;
    mockFetch({
      "/api/osf/children/bad01": () => (++n === 1 ? new Response("OSF is down", { status: 503 }) : json({ children: [comp("ok01", "Recovered", 0)] })),
    });
    renderTree([comp("bad01", "Flaky", 3)]);
    // 1 component: auto-expanded, so the list is requested straight away.
    const retry = await screen.findByRole("button", { name: "Retry loading Flaky" });
    fireEvent.click(retry);
    await waitFor(() => expect(screen.getByText("Recovered")).toBeInTheDocument());
  });

  it("opening many components at once keeps at most 3 component lists loading, and all of them still load", async () => {
    const pending: Array<() => void> = [];
    let inFlight = 0;
    let maxInFlight = 0;
    fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const u = String(url);
      calls.push(u);
      const m = u.match(/\/api\/osf\/children\/(\w+)/);
      if (m) {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise<void>((r) => pending.push(r));
        inFlight--;
        return json({ children: [comp(`${m[1]}k`, `Kid of ${m[1]}`, 0)] });
      }
      if (u.includes("/skeleton")) return json({ skeleton: [] });
      if (u.includes("/api/osf/write-status")) return json({ canWrite: false });
      return json({ entries: [] });
    });
    // 8 components: under the auto-expand cap, so all 8 open at once.
    renderTree(Array.from({ length: 8 }, (_, i) => comp(`m${i}`, `Many ${i}`, 1)));
    for (let done = 0; done < 8; ) {
      await waitFor(() => expect(pending.length).toBeGreaterThan(0));
      expect(inFlight).toBeLessThanOrEqual(3);
      const batch = pending.splice(0);
      batch.forEach((r) => r());
      done += batch.length;
    }
    for (let i = 0; i < 8; i++) await waitFor(() => expect(screen.getByText(`Kid of m${i}`)).toBeInTheDocument());
    expect(maxInFlight).toBe(3);
    expect(calls.filter((u) => u.includes("/api/osf/children/")).length).toBe(8);
    // Let the background folder loads (8 sections, all under the cap) finish inside the test.
    for (let i = 0; i < 8; i++) await waitFor(() => expect(calls.some((u) => u.includes(`/api/files/m${i}/skeleton`))).toBe(true));
  });

  it("an OSF failure to list components says so instead of showing nothing", () => {
    mockFetch({});
    render(
      <UnifiedTree guid="root1" rootTitle="Root" skeleton={[]} components={[]} componentTrees={[]} linkedNodes={[]} registrations={[]} componentsFailed />
    );
    expect(screen.getByText(/Components \(couldn't load from OSF/)).toBeInTheDocument();
  });

  it("control: a project with genuinely no components shows no Components row", () => {
    mockFetch({});
    render(<UnifiedTree guid="root1" rootTitle="Root" skeleton={[]} components={[]} componentTrees={[]} linkedNodes={[]} registrations={[]} />);
    expect(screen.queryByText(/Components/)).not.toBeInTheDocument();
  });
});
