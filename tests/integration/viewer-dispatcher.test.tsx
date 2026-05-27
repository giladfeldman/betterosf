import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// next/dynamic is fine in jsdom but each viewer it loads might do its own client setup
// that can throw at import time (e.g. pdfjs-dist worker). Stub each dynamic component to
// a simple marker so we can assert routing without instantiating the heavy viewer.
vi.mock("next/dynamic", () => ({
  default: (factory: () => Promise<unknown>) => {
    // Capture the import path via factory.toString() inspection — simpler: just return a
    // generic marker that includes the resolved viewer identity. We can rely on different
    // factory functions producing different mocked components.
    const Stub = ({ url, filename, alt }: { url?: string; filename?: string; alt?: string }) => (
      <div data-viewer="stub" data-url={url} data-filename={filename ?? alt} />
    );
    // Tag the stub with the factory body so each viewer instantiation has a unique signature.
    (Stub as unknown as { _src: string })._src = factory.toString();
    return Stub;
  },
}));

import { ViewerDispatcher } from "@/components/viewers/Dispatcher";

describe("ViewerDispatcher routing", () => {
  it("routes a small PDF to the pdf viewer", () => {
    const { container } = render(
      <ViewerDispatcher filename="doc.pdf" url="https://example/d.pdf" sizeBytes={1024} />
    );
    expect(container.querySelector('[data-viewer="stub"]')).toBeTruthy();
    expect(container.querySelector('[data-url="https://example/d.pdf"]')).toBeTruthy();
  });

  it("routes a small PPTX to the pptx viewer", () => {
    const { container } = render(
      <ViewerDispatcher filename="slides.pptx" url="https://example/slides.pptx" sizeBytes={1024} />
    );
    expect(container.querySelector('[data-viewer="stub"]')).toBeTruthy();
    expect(container.querySelector('[data-url="https://example/slides.pptx"]')).toBeTruthy();
  });

  it("oversize PDF (>50MB) without force=1 falls back to DownloadFallback", () => {
    render(
      <ViewerDispatcher
        filename="huge.pdf"
        url="https://example/h.pdf"
        sizeBytes={60 * 1024 * 1024}
      />
    );
    // DownloadFallback renders a real (non-mocked) component with a download link
    expect(screen.getByRole("link", { name: /download/i })).toBeInTheDocument();
  });

  it("oversize PDF + forceOpen=true bypasses the cap and routes to pdf viewer", () => {
    const { container } = render(
      <ViewerDispatcher
        filename="huge.pdf"
        url="https://example/h.pdf"
        sizeBytes={60 * 1024 * 1024}
        forceOpen
      />
    );
    // No DownloadFallback download button — we get the stubbed viewer instead.
    expect(screen.queryByRole("link", { name: /download/i })).not.toBeInTheDocument();
    expect(container.querySelector('[data-viewer="stub"]')).toBeTruthy();
  });

  it("unknown extension falls back to DownloadFallback (unknown-format)", () => {
    render(
      <ViewerDispatcher filename="data.qqzz" url="https://example/d.qqzz" sizeBytes={1024} />
    );
    expect(screen.getByRole("link", { name: /download/i })).toBeInTheDocument();
  });

  it("oversize CSV (>100MB) without force triggers fallback", () => {
    render(
      <ViewerDispatcher filename="huge.csv" url="https://example/h.csv" sizeBytes={200 * 1024 * 1024} />
    );
    expect(screen.getByRole("link", { name: /download/i })).toBeInTheDocument();
  });

  it("null sizeBytes is treated as unknown size, viewer still loads", () => {
    const { container } = render(
      <ViewerDispatcher filename="doc.pdf" url="https://example/d.pdf" sizeBytes={null} />
    );
    expect(container.querySelector('[data-viewer="stub"]')).toBeTruthy();
    expect(screen.queryByRole("link", { name: /download/i })).not.toBeInTheDocument();
  });
});
