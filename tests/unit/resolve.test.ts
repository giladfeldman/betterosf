import { describe, it, expect } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../msw/server";
import { resolveGuidType } from "@/lib/osf/resolve";

function guidHandler(guid: string, body: Record<string, unknown>) {
  return http.get(`https://api.osf.io/v2/guids/${guid}/`, () => HttpResponse.json(body));
}

describe("resolveGuidType", () => {
  it("maps a node", async () => {
    server.use(guidHandler("nodea", { data: { id: "nodea", type: "nodes" } }));
    const r = await resolveGuidType("nodea");
    expect(r.kind).toBe("node");
    expect(r.id).toBe("nodea");
  });

  it("maps a registration (the P9QB4 bug)", async () => {
    server.use(guidHandler("regaa", { data: { id: "regaa", type: "registrations" } }));
    const r = await resolveGuidType("regaa");
    expect(r.kind).toBe("registration");
  });

  it("maps a preprint", async () => {
    server.use(guidHandler("prepa", { data: { id: "prepa", type: "preprints" } }));
    expect((await resolveGuidType("prepa")).kind).toBe("preprint");
  });

  it("maps a user", async () => {
    server.use(guidHandler("usera", { data: { id: "usera", type: "users" } }));
    expect((await resolveGuidType("usera")).kind).toBe("user");
  });

  it("maps an unknown type to 'unknown'", async () => {
    server.use(guidHandler("colla", { data: { id: "colla", type: "collections" } }));
    expect((await resolveGuidType("colla")).kind).toBe("unknown");
  });

  it("parses a file referent into viewer parts (target relationship)", async () => {
    server.use(
      guidHandler("filea", {
        data: {
          id: "filea",
          type: "files",
          attributes: { provider: "osfstorage", materialized_path: "/data/raw.csv", name: "raw.csv" },
          relationships: { target: { data: { id: "node99", type: "nodes" } } },
        },
      }),
    );
    const r = await resolveGuidType("filea");
    expect(r.kind).toBe("file");
    if (r.kind === "file") {
      expect(r.file).toEqual({ resourceId: "node99", provider: "osfstorage", path: "data/raw.csv", name: "raw.csv" });
    }
  });

  it("falls back to the html link for the file's node when no target relationship", async () => {
    server.use(
      guidHandler("fileb", {
        data: {
          id: "fileb",
          type: "files",
          attributes: { provider: "osfstorage", materialized_path: "/x.txt", name: "x.txt" },
          links: { html: "https://osf.io/node77/files/osfstorage/x.txt" },
        },
      }),
    );
    const r = await resolveGuidType("fileb");
    if (r.kind === "file") expect(r.file?.resourceId).toBe("node77");
  });

  it("returns file:null when the referent lacks enough info to build a viewer URL", async () => {
    server.use(guidHandler("filec", { data: { id: "filec", type: "files", attributes: {} } }));
    const r = await resolveGuidType("filec");
    expect(r.kind).toBe("file");
    if (r.kind === "file") expect(r.file).toBeNull();
  });
});
