import { describe, it, expect, vi } from "vitest";
import { collectAll } from "@/lib/osf/paginate";

describe("collectAll", () => {
  it("returns single page when no next link", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce({
      data: [{ id: "1" }, { id: "2" }],
      links: { next: null },
    });
    const result = await collectAll(fetcher);
    expect(result).toEqual([{ id: "1" }, { id: "2" }]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("follows next links to completion", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({ data: [{ id: "1" }], links: { next: "PAGE2" } })
      .mockResolvedValueOnce({ data: [{ id: "2" }], links: { next: "PAGE3" } })
      .mockResolvedValueOnce({ data: [{ id: "3" }], links: { next: null } });
    const result = await collectAll(fetcher);
    expect(result).toEqual([{ id: "1" }, { id: "2" }, { id: "3" }]);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(fetcher).toHaveBeenNthCalledWith(2, "PAGE2");
    expect(fetcher).toHaveBeenNthCalledWith(3, "PAGE3");
  });

  it("aborts at maxPages safety cap", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue({ data: [{ id: "x" }], links: { next: "MORE" } });
    await expect(collectAll(fetcher, { maxPages: 3 })).rejects.toThrow(/maxPages/);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
});
