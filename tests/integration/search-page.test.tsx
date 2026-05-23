import { describe, it, expect } from "vitest";
import { http, HttpResponse } from "msw";
import { render, screen } from "@testing-library/react";
import { server } from "../msw/server";
import SearchPage from "@/app/search/page";

describe("Search page", () => {
  it("renders empty-query prompt when q is missing", async () => {
    const ui = await SearchPage({ searchParams: Promise.resolve({}) });
    render(ui);
    expect(screen.getByRole("heading", { name: /search osf/i })).toBeInTheDocument();
    expect(screen.getByText(/type a query above/i)).toBeInTheDocument();
  });

  it("renders project results", async () => {
    server.use(
      http.get("https://api.osf.io/v2/nodes/", () =>
        HttpResponse.json({
          data: [
            { id: "p1", type: "nodes", attributes: { title: "Replication 1", description: "x", public: true, tags: [], category: "project" }, relationships: {}, links: { html: "https://osf.io/p1/" } },
          ],
          links: { next: null },
          meta: { total: 1 },
        })
      )
    );
    const ui = await SearchPage({ searchParams: Promise.resolve({ q: "replication" }) });
    render(ui);
    expect(screen.getByText(/Showing 1 of 1 result/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Replication 1/ })).toHaveAttribute("href", "/p1");
  });

  it("renders type chips with correct hrefs", async () => {
    server.use(
      http.get("https://api.osf.io/v2/nodes/", () => HttpResponse.json({ data: [], links: { next: null }, meta: { total: 0 } }))
    );
    const ui = await SearchPage({ searchParams: Promise.resolve({ q: "x" }) });
    render(ui);
    const chips = ["Projects", "Files", "Registrations", "Users"];
    for (const label of chips) {
      const a = screen.getByRole("link", { name: label });
      expect(a).toHaveAttribute("href", expect.stringContaining(`/search?q=x&type=${label.toLowerCase()}`));
    }
  });
});
