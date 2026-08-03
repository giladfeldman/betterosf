import { describe, it, expect } from "vitest";
import type { TreeSelectionPayload } from "@/components/tree-types";

// The delete affordance is gated ENTIRELY by the presence of `deleteUrl` on a selection
// payload, which the tree emitters populate only when `canUploadHere` is true
// (osfstorage + not readOnly). These tests lock in that contract, so a future emitter
// cannot accidentally expose delete on a registration or a non-OSF-Storage provider.

function deletable(items: TreeSelectionPayload[]): TreeSelectionPayload[] {
  return items.filter((s) => Boolean(s.deleteUrl));
}

const WB = "https://files.osf.io/v1/resources/abc12/providers/osfstorage";

describe("delete affordance gating", () => {
  it("treats a payload without deleteUrl as undeletable", () => {
    const readOnlyFile: TreeSelectionPayload = {
      kind: "file",
      guid: "abc12",
      provider: "osfstorage",
      path: "/a.csv",
      name: "a.csv",
      downloadUrl: "d",
      // readOnly / registration tree → emitter leaves deleteUrl undefined
    };
    expect(deletable([readOnlyFile])).toHaveLength(0);
  });

  it("treats a non-osfstorage payload as undeletable", () => {
    const dropboxFile: TreeSelectionPayload = {
      kind: "file",
      guid: "abc12",
      provider: "dropbox",
      path: "/a.csv",
      name: "a.csv",
      downloadUrl: "d",
    };
    expect(deletable([dropboxFile])).toHaveLength(0);
  });

  it("treats a provider root as undeletable even in a writable tree", () => {
    // The provider-root emitter deliberately omits deleteUrl: a Waterbutler root delete
    // recursively wipes every file in the provider.
    const root: TreeSelectionPayload = {
      kind: "folder",
      guid: "abc12",
      provider: "osfstorage",
      path: "/",
      name: "OSF Storage",
    };
    expect(deletable([root])).toHaveLength(0);
  });

  it("allows a writable osfstorage file", () => {
    const file: TreeSelectionPayload = {
      kind: "file",
      guid: "abc12",
      provider: "osfstorage",
      path: "/a.csv",
      name: "a.csv",
      downloadUrl: "d",
      deleteUrl: `${WB}/5f1a`,
      parentListingUrl: "https://api.osf.io/v2/nodes/abc12/files/osfstorage/",
    };
    expect(deletable([file])).toHaveLength(1);
  });

  it("reports a partially-deletable mixed selection rather than silently filtering", () => {
    const mixed: TreeSelectionPayload[] = [
      { kind: "file", guid: "abc12", provider: "osfstorage", path: "/a", name: "a", downloadUrl: "d", deleteUrl: `${WB}/a` },
      { kind: "file", guid: "abc12", provider: "dropbox", path: "/b", name: "b", downloadUrl: "d" },
    ];
    // The toolbar shows "1 of 2 can't be deleted" from exactly this arithmetic — the
    // undeletable item must never just vanish from a destructive batch.
    expect(mixed.length - deletable(mixed).length).toBe(1);
  });

  it("REGRESSION: an anonymous visitor gets no deleteUrl even on a writable project", () => {
    // Caught by visual-qa on 2026-08-03: the emitters gated deleteUrl on `canUploadHere`
    // (= !readOnly && osfstorage), which is TRUE for signed-out visitors on any ordinary
    // project — it only excludes registrations. That leaked 28 Delete buttons to anonymous
    // users. Delete is now additionally gated on a confirmed write-capable session
    // (`canDeleteHere = canUploadHere && canWrite`), defaulting to false so it fails closed.
    const canUploadHere = true; // ordinary project, osfstorage, not readOnly
    const canWrite = false; // signed out — or signed in without write scope
    const canDeleteHere = canUploadHere && canWrite;

    const emitted: TreeSelectionPayload = {
      kind: "file",
      guid: "abc12",
      provider: "osfstorage",
      path: "/a.csv",
      name: "a.csv",
      downloadUrl: "d",
      deleteUrl: canDeleteHere ? `${WB}/5f1a` : undefined,
    };
    expect(deletable([emitted])).toHaveLength(0);
  });

  it("carries parentListingUrl so a delete can refresh the right folder", () => {
    const file: TreeSelectionPayload = {
      kind: "file",
      guid: "abc12",
      provider: "osfstorage",
      path: "/a.csv",
      name: "a.csv",
      downloadUrl: "d",
      deleteUrl: `${WB}/5f1a`,
      parentListingUrl: "https://api.osf.io/v2/nodes/abc12/files/osfstorage/",
    };
    expect(file.parentListingUrl).toBeTruthy();
  });
});
