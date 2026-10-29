import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { UnifiedTreeNode, type TreeNodeData } from "@/components/UnifiedTreeNode";

function baseNode(overrides: Partial<TreeNodeData> = {}): TreeNodeData {
  return { id: "n", label: "node", kind: "folder", ...overrides };
}

describe("UnifiedTreeNode kinds", () => {
  for (const kind of [
    "folder",
    "file",
    "component",
    "registration",
    "linked",
    "provider-root",
    "components-root",
    "linked-root",
    "registrations-root",
    "pinned-root",
  ] as const) {
    it(`renders a ${kind} node with its label`, () => {
      render(
        <UnifiedTreeNode
          node={baseNode({ kind, label: `lbl-${kind}` })}
          depth={0}
          expanded={false}
          hasChildren={false}
          onToggle={() => {}}
        />
      );
      expect(screen.getByText(`lbl-${kind}`)).toBeInTheDocument();
    });
  }
});

describe("UnifiedTreeNode: container left-click toggles", () => {
  it("plain left-click on folder anchor preventsDefault + calls onToggle", () => {
    const onToggle = vi.fn();
    render(
      <UnifiedTreeNode
        node={baseNode({ kind: "folder", href: "/x/files/osfstorage/sub/" })}
        depth={1}
        expanded={false}
        hasChildren={true}
        onToggle={onToggle}
      />
    );
    const link = screen.getByRole("link");
    const ev = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
    fireEvent(link, ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  for (const mod of ["metaKey", "ctrlKey", "shiftKey", "altKey"] as const) {
    it(`${mod}+click on folder does NOT preventDefault and does NOT toggle`, () => {
      const onToggle = vi.fn();
      render(
        <UnifiedTreeNode
          node={baseNode({ kind: "folder", href: "/x/files/osfstorage/sub/" })}
          depth={1}
          expanded={false}
          hasChildren={true}
          onToggle={onToggle}
        />
      );
      const link = screen.getByRole("link");
      // We must build a MouseEvent with the modifier, since fireEvent.click defaults strip them.
      const ev = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, [mod]: true } as MouseEventInit);
      fireEvent(link, ev);
      expect(ev.defaultPrevented).toBe(false);
      expect(onToggle).not.toHaveBeenCalled();
    });
  }

  it("non-container kinds (file with href + newTab) do NOT preventDefault", () => {
    const onToggle = vi.fn();
    render(
      <UnifiedTreeNode
        node={baseNode({ kind: "file", href: "/g/files/view/osfstorage/x.pdf", newTab: true })}
        depth={1}
        expanded={false}
        hasChildren={false}
        onToggle={onToggle}
      />
    );
    const link = screen.getByRole("link");
    const ev = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
    fireEvent(link, ev);
    expect(ev.defaultPrevented).toBe(false);
    expect(onToggle).not.toHaveBeenCalled();
  });

  // Regression: prior to 2026-05-26, clicking a registration row with a
  // populated sub-tree NAVIGATED to /registrations/<guid> instead of
  // expanding inline — because `interceptLeftClick` didn't include
  // "registration" (or "component"). visual-qa caught this when the
  // registrationTrees feature shipped.
  it("registration with hasChildren preventsDefault + calls onToggle (sub-tree expand)", () => {
    const onToggle = vi.fn();
    render(
      <UnifiedTreeNode
        node={baseNode({ kind: "registration", href: "/registrations/abc12", label: "Reg" })}
        depth={1}
        expanded={false}
        hasChildren={true}
        onToggle={onToggle}
      />
    );
    const link = screen.getByRole("link");
    const ev = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
    fireEvent(link, ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("registration with NO children navigates as a leaf (no preventDefault)", () => {
    const onToggle = vi.fn();
    render(
      <UnifiedTreeNode
        node={baseNode({ kind: "registration", href: "/registrations/abc12", label: "Reg" })}
        depth={1}
        expanded={false}
        hasChildren={false}
        onToggle={onToggle}
      />
    );
    const link = screen.getByRole("link");
    const ev = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
    fireEvent(link, ev);
    expect(ev.defaultPrevented).toBe(false);
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("component with hasChildren preventsDefault + calls onToggle", () => {
    const onToggle = vi.fn();
    render(
      <UnifiedTreeNode
        node={baseNode({ kind: "component", href: "/abc12", label: "Comp" })}
        depth={1}
        expanded={false}
        hasChildren={true}
        onToggle={onToggle}
      />
    );
    const link = screen.getByRole("link");
    const ev = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
    fireEvent(link, ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});

describe("UnifiedTreeNode: file leaf attributes", () => {
  it("file with newTab=true renders target=_blank + rel=noopener", () => {
    render(
      <UnifiedTreeNode
        node={baseNode({ kind: "file", href: "/x/files/view/osfstorage/y.txt", newTab: true })}
        depth={2}
        expanded={false}
        hasChildren={false}
        onToggle={() => {}}
      />
    );
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener");
  });

  it("file with newTab=false does NOT set target/rel", () => {
    render(
      <UnifiedTreeNode
        node={baseNode({ kind: "file", href: "/x", newTab: false })}
        depth={2}
        expanded={false}
        hasChildren={false}
        onToggle={() => {}}
      />
    );
    const link = screen.getByRole("link");
    expect(link).not.toHaveAttribute("target");
    expect(link).not.toHaveAttribute("rel");
  });
});

describe("UnifiedTreeNode: expand chevron button", () => {
  it("clicking the chevron triggers onToggle regardless of node kind", () => {
    const onToggle = vi.fn();
    render(
      <UnifiedTreeNode
        node={baseNode({ kind: "folder", href: "/x" })}
        depth={0}
        expanded={true}
        hasChildren={true}
        onToggle={onToggle}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /collapse/i }));
    expect(onToggle).toHaveBeenCalled();
  });

  it("chevron is invisible (no children) but still rendered for alignment", () => {
    render(
      <UnifiedTreeNode
        node={baseNode({ kind: "file", href: "/x", newTab: true })}
        depth={1}
        expanded={false}
        hasChildren={false}
        onToggle={() => {}}
      />
    );
    // The button still exists with aria-label "Expand" (since expanded=false)
    const chevron = screen.getByRole("button", { name: /expand/i });
    expect(chevron.className).toMatch(/invisible/);
  });
});

describe("UnifiedTreeNode: rename/delete affordance gating", () => {
  const WB = "https://files.osf.io/v1/resources/abc12/providers/osfstorage";
  const writableSelection = {
    kind: "file" as const,
    guid: "abc12",
    provider: "osfstorage",
    path: "/a.csv",
    name: "a.csv",
    downloadUrl: "d",
    deleteUrl: `${WB}/5f1a`,
    parentListingUrl: "https://api.osf.io/v2/nodes/abc12/files/osfstorage/",
  };

  it("renders Rename and Delete for a writable selection (deleteUrl present)", () => {
    render(
      <UnifiedTreeNode
        node={baseNode({ kind: "file", href: "/x", newTab: false, selection: writableSelection })}
        depth={1}
        expanded={false}
        hasChildren={false}
        onToggle={() => {}}
      />
    );
    expect(screen.getByRole("button", { name: /^rename a\.csv/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^move a\.csv/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^delete/i })).toBeInTheDocument();
  });

  it("renders NEITHER Rename nor Delete without deleteUrl (read-only / anonymous / registration)", () => {
    // The emitters only set deleteUrl when canDeleteHere = canUploadHere && canWrite —
    // this is the same fail-closed gate that fixed the 2026-08-03 leaked-Delete incident.
    const { deleteUrl: _d, parentListingUrl: _p, ...readOnlySelection } = writableSelection;
    render(
      <UnifiedTreeNode
        node={baseNode({ kind: "file", href: "/x", newTab: false, selection: readOnlySelection })}
        depth={1}
        expanded={false}
        hasChildren={false}
        onToggle={() => {}}
      />
    );
    expect(screen.queryByRole("button", { name: /rename/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /delete/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^move/i })).not.toBeInTheDocument();
  });

  it("suppresses Rename when parentListingUrl is missing (registration pin + refresh need it)", () => {
    const { parentListingUrl: _p, ...noParent } = writableSelection;
    render(
      <UnifiedTreeNode
        node={baseNode({ kind: "file", href: "/x", newTab: false, selection: noParent })}
        depth={1}
        expanded={false}
        hasChildren={false}
        onToggle={() => {}}
      />
    );
    expect(screen.queryByRole("button", { name: /rename/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^move/i })).not.toBeInTheDocument();
  });

  it("opens an inline input prefilled with the current name", () => {
    render(
      <UnifiedTreeNode
        node={baseNode({ kind: "file", href: "/x", newTab: false, selection: writableSelection })}
        depth={1}
        expanded={false}
        hasChildren={false}
        onToggle={() => {}}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /^rename a\.csv/i }));
    const input = screen.getByRole("textbox", { name: /new name for a\.csv/i });
    expect(input).toHaveValue("a.csv");
  });
});

describe("UnifiedTreeNode: aria + selection", () => {
  it("treeitem aria-expanded is set only when hasChildren", () => {
    const { rerender } = render(
      <UnifiedTreeNode
        node={baseNode({ kind: "folder", href: "/x" })}
        depth={0}
        expanded={true}
        hasChildren={true}
        onToggle={() => {}}
      />
    );
    expect(screen.getByRole("treeitem")).toHaveAttribute("aria-expanded", "true");
    rerender(
      <UnifiedTreeNode
        node={baseNode({ kind: "file", href: "/x", newTab: true })}
        depth={0}
        expanded={false}
        hasChildren={false}
        onToggle={() => {}}
      />
    );
    expect(screen.getByRole("treeitem")).not.toHaveAttribute("aria-expanded");
  });

  it("selected=true sets aria-selected=true", () => {
    render(
      <UnifiedTreeNode
        node={baseNode({ kind: "file", href: "/x", newTab: true })}
        depth={1}
        expanded={false}
        hasChildren={false}
        onToggle={() => {}}
        selected
      />
    );
    expect(screen.getByRole("treeitem")).toHaveAttribute("aria-selected", "true");
  });
});
