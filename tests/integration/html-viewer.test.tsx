import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { HtmlViewer } from "@/components/viewers/HtmlViewer";

describe("HtmlViewer", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // jsdom doesn't implement object URLs; stub them.
    globalThis.URL.createObjectURL = vi.fn(() => "blob:mock-url");
    globalThis.URL.revokeObjectURL = vi.fn();
  });

  it("renders via a blob: src (not srcDoc) in a scripts-disabled iframe so in-page anchors stay in the document", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response("<html><body><a href=\"#s\">x</a><h2 id=\"s\">S</h2></body></html>", { status: 200 })
      );

    const { container } = render(<HtmlViewer url="/api/files/abc12/download?u=x" />);

    await waitFor(() => {
      const iframe = container.querySelector("iframe");
      expect(iframe?.getAttribute("src")).toBe("blob:mock-url");
    });

    const iframe = container.querySelector("iframe")!;
    // The fix: a blob: document has its own base URL, so srcDoc (which inherits
    // the parent page's base URL and causes BetterOSF-in-BetterOSF recursion on
    // anchor clicks) must NOT be used.
    expect(iframe.hasAttribute("srcdoc")).toBe(false);
    // Scripts stay disabled; allow-same-origin only so the blob can load.
    expect(iframe.getAttribute("sandbox")).toBe("allow-same-origin");
    expect(globalThis.URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/files/abc12/download?u=x");
  });

  it("shows a download fallback when the fetch fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("nope", { status: 500 }));

    render(<HtmlViewer url="/api/files/abc12/download?u=x" />);

    await waitFor(() => expect(screen.getByText(/could not be previewed/i)).toBeInTheDocument());
    expect(screen.getByText(/Download HTML/i)).toBeInTheDocument();
  });
});
