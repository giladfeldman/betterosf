/**
 * d-29cde1: wiki page names arrive HTML-escaped. Measured 2026-11-19 by creating a wiki named
 * 'R&D <b> "q" probe' on the throwaway OSF account (wf83z, project kah6t, wiki 34sqv): OSF
 * returned 'R&amp;D  "q" probe'. Before decoding, the ZIP named the page "R&amp;D ….md".
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/osf/client", () => ({
  osfGet: vi.fn(async () => ({
    data: [{ id: "34sqv", attributes: { name: 'R&amp;D  "q" probe', size: 42 } }],
    links: { next: null },
  })),
  osfGetUrl: vi.fn(),
}));

import { getNodeWikis } from "@/lib/osf/wikis";

describe("wiki names are decoded once at parse", () => {
  it("the measured OSF value reads as the author typed it", async () => {
    const [wiki] = await getNodeWikis("kah6t");
    expect(wiki?.name).toBe('R&D  "q" probe');
  });
});
