import { describe, expect, it } from "vitest";
import type { FavoriteRef } from "@/lib/favorites";

describe("bookmark ref shape", () => {
  it("accepts folder favorites", () => {
    const ref: FavoriteRef = {
      id: "abc12/osfstorage/data",
      title: "data",
      kind: "folder",
    };
    expect(ref.kind).toBe("folder");
    expect(ref.id.includes("/")).toBe(true);
  });
});
