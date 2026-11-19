/**
 * d-99070d: a failed linked-projects, registrations or component lookup must read as
 * UNKNOWN, never as zero / "no matches". Same class as the v1.15.0 componentsFailed fix.
 * One test per site that used `.catch(() => [])`, each with a control where OSF answers
 * an empty list and nothing is flagged.
 */
import { describe, it, expect } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../msw/server";
import { collectFullTree } from "@/lib/osf/full-tree";
import { collectResourceTree } from "@/lib/osf/resource-tree";
import { searchInProjectScope } from "@/lib/osf/search";

const empty = () => HttpResponse.json({ data: [], links: { next: null } });
const boom = () => HttpResponse.json({ errors: [{ detail: "boom" }] }, { status: 503 });

function project(guid: string, opts: { linked: "ok" | "fail"; regs: "ok" | "fail"; children: "ok" | "fail" }) {
  server.use(
    http.get(`https://api.osf.io/v2/nodes/${guid}/`, () =>
      HttpResponse.json({
        data: {
          id: guid, type: "nodes",
          attributes: { title: "P", description: "", category: "project", public: true, tags: [], date_created: "", date_modified: "" },
          relationships: {},
          links: { html: `https://osf.io/${guid}/` },
        },
      }),
    ),
    http.get(`https://api.osf.io/v2/nodes/${guid}/files/`, empty),
    http.get(`https://api.osf.io/v2/nodes/${guid}/children/`, opts.children === "ok" ? empty : boom),
    http.get(`https://api.osf.io/v2/nodes/${guid}/linked_nodes/`, opts.linked === "ok" ? empty : boom),
    http.get(`https://api.osf.io/v2/nodes/${guid}/registrations/`, opts.regs === "ok" ? empty : boom),
  );
}

describe("collectFullTree", () => {
  it("flags failed linked and registration lists", async () => {
    project("fta01", { linked: "fail", regs: "fail", children: "ok" });
    const t = await collectFullTree("fta01");
    expect(t.linkedFailed).toBe(true);
    expect(t.registrationsFailed).toBe(true);
  });
  it("control: empty lists are not flagged", async () => {
    project("fta02", { linked: "ok", regs: "ok", children: "ok" });
    const t = await collectFullTree("fta02");
    expect(t.linkedFailed).toBe(false);
    expect(t.registrationsFailed).toBe(false);
  });
});

describe("collectResourceTree", () => {
  it("flags failed linked and registration lists", async () => {
    project("rta01", { linked: "fail", regs: "fail", children: "ok" });
    const r = await collectResourceTree("rta01");
    expect(r.linkedFailed).toBe(true);
    expect(r.registrationsFailed).toBe(true);
    expect(r.linked).toEqual([]);
  });
  it("control: empty lists are not flagged", async () => {
    project("rta02", { linked: "ok", regs: "ok", children: "ok" });
    const r = await collectResourceTree("rta02");
    expect(r.linkedFailed).toBe(false);
    expect(r.registrationsFailed).toBe(false);
  });
});

describe("searchInProjectScope", () => {
  it("flags every list OSF did not return", async () => {
    project("sca01", { linked: "fail", regs: "fail", children: "fail" });
    const out = await searchInProjectScope("sca01", "x");
    expect(out.failed).toEqual({ components: true, linked: true, registrations: true });
  });
  it("control: empty lists are searched, not flagged", async () => {
    project("sca02", { linked: "ok", regs: "ok", children: "ok" });
    const out = await searchInProjectScope("sca02", "x");
    expect(out.failed).toEqual({ components: false, linked: false, registrations: false });
  });
});
