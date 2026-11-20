import { describe, it, expect } from "vitest";
import { http, HttpResponse } from "msw";
import { render, screen } from "@testing-library/react";
import { server } from "../msw/server";
import ProjectPage from "@/app/[guid]/page";
import FilesPage from "@/app/[guid]/files/page";
import DeepFilesPage from "@/app/[guid]/files/[...path]/page";
import FileViewerPage from "@/app/[guid]/files/view/[...path]/page";
import CompareRegistrationsPage from "@/app/registrations/compare/page";
import { RegistrationOverview } from "@/components/RegistrationOverview";
import { PreprintOverview } from "@/components/PreprintOverview";
import { UserProfile } from "@/components/UserProfile";

/**
 * d-0f12b5: OSF answers HTTP 410 Gone for a DELETED resource (measured 2026-10-30 on
 * k3ny2). The OSF client maps 410 to code "not_found" (keeping status 410), and every
 * page that turned "not_found" into notFound() showed a generic "Project not found ...
 * doesn't exist or the GUID is malformed" — a distinct upstream state collapsed into a
 * generic one. The ZIP route already says "deleted on OSF" (d-f2d4f3); the pages must too.
 *
 * Each test makes EVERY OSF v2 call answer 410 and asserts the page renders the
 * deleted notice instead of throwing Next's not-found signal.
 */
function goneAllOsf() {
  server.use(http.get("https://api.osf.io/v2/*", () => new HttpResponse(null, { status: 410 })));
}

function expectDeletedNotice() {
  expect(screen.getByRole("heading", { name: /deleted on osf/i })).toBeInTheDocument();
}

describe("OSF 410 Gone renders 'deleted on OSF', not a generic not-found", () => {
  it("/[guid] project overview", async () => {
    goneAllOsf();
    render(await ProjectPage({ params: Promise.resolve({ guid: "gonea" }), searchParams: Promise.resolve({}) }));
    expectDeletedNotice();
    expect(screen.getByRole("heading", { name: /this project was deleted on osf/i })).toBeInTheDocument();
  });

  it("/[guid]/files", async () => {
    goneAllOsf();
    render(await FilesPage({ params: Promise.resolve({ guid: "goneb" }) }));
    expectDeletedNotice();
  });

  it("/[guid]/files/[...path] deep folder", async () => {
    goneAllOsf();
    render(await DeepFilesPage({ params: Promise.resolve({ guid: "gonec", path: ["osfstorage", "sub"] }) }));
    expectDeletedNotice();
  });

  it("/[guid]/files/view/[...path] file viewer", async () => {
    goneAllOsf();
    render(
      await FileViewerPage({
        params: Promise.resolve({ guid: "goned", path: ["osfstorage", "a.csv"] }),
        searchParams: Promise.resolve({}),
      }),
    );
    expectDeletedNotice();
  });

  it("registration overview", async () => {
    goneAllOsf();
    render(await RegistrationOverview({ guid: "gonee" }));
    expectDeletedNotice();
  });

  it("preprint overview", async () => {
    goneAllOsf();
    render(await PreprintOverview({ guid: "gonef" }));
    expectDeletedNotice();
  });

  it("user profile", async () => {
    goneAllOsf();
    render(await UserProfile({ guid: "goneg", basePath: "/users/goneg", searchParams: {} }));
    expectDeletedNotice();
  });

  it("/registrations/compare", async () => {
    goneAllOsf();
    render(await CompareRegistrationsPage({ searchParams: Promise.resolve({ a: "goneh", b: "gonei" }) }));
    expectDeletedNotice();
  });

  it("control: a plain 404 still goes to the generic not-found page", async () => {
    server.use(http.get("https://api.osf.io/v2/*", () => new HttpResponse(null, { status: 404 })));
    await expect(FilesPage({ params: Promise.resolve({ guid: "gonej" }) })).rejects.toThrow();
  });
});
