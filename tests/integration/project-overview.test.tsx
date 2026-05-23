import { describe, it, expect } from "vitest";
import { http, HttpResponse } from "msw";
import { render, screen } from "@testing-library/react";
import { server } from "../msw/server";
import ProjectPage from "@/app/[guid]/page";

describe("Project overview page", () => {
  it("renders title and description for a public project", async () => {
    server.use(
      http.get("https://api.osf.io/v2/nodes/ezcuj/", () =>
        HttpResponse.json({
          data: {
            id: "ezcuj",
            type: "nodes",
            attributes: {
              title: "Many Labs 2",
              description: "Investigating Variation",
              public: true,
              category: "project",
              tags: ["replication"],
            },
            relationships: {},
            links: { html: "https://osf.io/ezcuj/" },
          },
        })
      ),
      http.get("https://api.osf.io/v2/nodes/ezcuj/children/", () => HttpResponse.json({ data: [], links: { next: null } })),
      http.get("https://api.osf.io/v2/nodes/ezcuj/linked_nodes/", () => HttpResponse.json({ data: [], links: { next: null } })),
      http.get("https://api.osf.io/v2/nodes/ezcuj/registrations/", () => HttpResponse.json({ data: [], links: { next: null } })),
    );
    const ui = await ProjectPage({ params: Promise.resolve({ guid: "ezcuj" }) });
    render(ui);
    expect(screen.getByRole("heading", { name: /Many Labs 2/i })).toBeInTheDocument();
    expect(screen.getByText(/Investigating Variation/i)).toBeInTheDocument();
  });
});
