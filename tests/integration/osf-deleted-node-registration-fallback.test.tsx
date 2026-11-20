import { describe, it, expect } from "vitest";
import { http, HttpResponse } from "msw";
import { render, screen } from "@testing-library/react";
import { server } from "../msw/server";
import FilesPage from "@/app/[guid]/files/page";
import DeepFilesPage from "@/app/[guid]/files/[...path]/page";
import FileViewerPage from "@/app/[guid]/files/view/[...path]/page";

/**
 * Review finding, 2026-11-20: a deleted NODE answers 410 on /v2/nodes/{id}/ but the
 * /v2/registrations/{id}/ fallback these pages try next answers 404 (measured live on k3ny2:
 * nodes 410, registrations 404). The fallback's 404 replaced the 410, so the pages showed the
 * generic not-found page instead of "deleted on OSF". osf-deleted-410.test.tsx mocks EVERY
 * endpoint as 410, which the real OSF does not do, so it could not see this.
 */
function nodeGoneRegistrationAbsent() {
  server.use(
    http.get("https://api.osf.io/v2/nodes/*", () => new HttpResponse(null, { status: 410 })),
    http.get("https://api.osf.io/v2/registrations/*", () => new HttpResponse(null, { status: 404 })),
  );
}

describe("a deleted node whose registration fallback answers 404 still reads as deleted", () => {
  it("/[guid]/files", async () => {
    nodeGoneRegistrationAbsent();
    render(await FilesPage({ params: Promise.resolve({ guid: "gonef" }) }));
    expect(screen.getByRole("heading", { name: /deleted on osf/i })).toBeInTheDocument();
  });

  it("/[guid]/files/[...path]", async () => {
    nodeGoneRegistrationAbsent();
    render(await DeepFilesPage({ params: Promise.resolve({ guid: "goneg", path: ["osfstorage", "sub"] }) }));
    expect(screen.getByRole("heading", { name: /deleted on osf/i })).toBeInTheDocument();
  });

  it("/[guid]/files/view/[...path]", async () => {
    nodeGoneRegistrationAbsent();
    render(
      await FileViewerPage({
        params: Promise.resolve({ guid: "goneh", path: ["osfstorage", "a.csv"] }),
        searchParams: Promise.resolve({}),
      }),
    );
    expect(screen.getByRole("heading", { name: /deleted on osf/i })).toBeInTheDocument();
  });
});
