import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { NotebookViewer } from "@/components/viewers/NotebookViewer";

describe("NotebookViewer sanitization", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sanitizes active HTML output from notebook cells", async () => {
    const notebook = {
      cells: [
        {
          cell_type: "code",
          source: "print('x')",
          outputs: [
            {
              output_type: "display_data",
              data: {
                "text/html": "<div><img src=x onerror=alert(1)><script>alert('xss')</script><p>safe</p></div>",
              },
            },
          ],
        },
      ],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => notebook,
      })) as unknown as typeof fetch
    );

    const { container } = render(<NotebookViewer url="https://example.com/notebook.ipynb" />);

    await waitFor(() => expect(screen.getByText("safe")).toBeInTheDocument());
    expect(container.querySelector("script")).toBeNull();
    const img = container.querySelector("img");
    expect(img?.getAttribute("onerror")).toBeNull();
  });
});
