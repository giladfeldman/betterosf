// The OSF token a transition run uses to pull bytes from Waterbutler.
//
// This route exists because of a real defect in v1.8.0: `ExportRunner` asked
// `/api/osf/upload-token`, which requires `session.osfCanWrite`, while `TransitionGate`
// signs users in with **read-only** scope on purpose. Every user who arrived through
// /transition and signed in there got a 403 the moment they pressed Start — on the
// headline feature of that release.
//
// So the tests are in two halves: this route must work for a read-only session, and no
// transition surface may go back to the write-scoped one.

import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";

vi.mock("@/lib/db/require-user", () => ({ requireAppUser: vi.fn() }));
vi.mock("@/lib/db/transition-consents", () => ({
  userHasToolkitConsent: vi.fn().mockResolvedValue(true),
  recordConsent: vi.fn(),
  listToolkitConsents: vi.fn(),
}));

const session: { value: Record<string, unknown> | null } = { value: null };
vi.mock("@/auth", () => ({ auth: async () => session.value }));

import { GET } from "@/app/api/transition/osf-token/route";
import { requireAppUser } from "@/lib/db/require-user";
import { userHasToolkitConsent } from "@/lib/db/transition-consents";

beforeEach(() => {
  vi.mocked(requireAppUser).mockReset().mockResolvedValue({ ok: true, userId: "u1", osfUserId: "osf1" });
  vi.mocked(userHasToolkitConsent).mockReset().mockResolvedValue(true);
  session.value = null;
});

describe("GET /api/transition/osf-token", () => {
  it("returns the token for a READ-ONLY session — the whole point of this route", async () => {
    session.value = { accessToken: "osf-access", osfCanWrite: false, osfAccessTokenExpires: 123 };
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ token: "osf-access", expiresAt: 123 });
  });

  it("never caches the token", async () => {
    session.value = { accessToken: "osf-access", osfCanWrite: false };
    const res = await GET();
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("refuses anonymously", async () => {
    vi.mocked(requireAppUser).mockResolvedValue({ ok: false, status: 401, error: "sign in" });
    expect((await GET()).status).toBe(401);
  });

  it("refuses without transition consent, like every other transition route", async () => {
    vi.mocked(userHasToolkitConsent).mockResolvedValue(false);
    const res = await GET();
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("consent_required");
  });

  it("refuses when the OSF connection has expired instead of handing out a dead token", async () => {
    session.value = { accessToken: "stale", osfAuthError: "RefreshAccessTokenError" };
    const res = await GET();
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("osf_auth_error");
  });

  it("refuses when the session carries no access token at all", async () => {
    session.value = { osfCanWrite: true };
    expect((await GET()).status).toBe(401);
  });
});

describe("transition surfaces do not depend on write scope", () => {
  it("no transition component asks for the write-scoped upload token", () => {
    // `/api/osf/upload-token` requires osfCanWrite. Reintroducing it here would re-break
    // export and transfer for every read-only user, silently and completely.
    const dir = path.join(process.cwd(), "src/components/transition");
    // A fetch CALL, not a mention: the comment in ExportRunner names the route on purpose,
    // to explain why it is not used.
    const callsIt = /fetch\(\s*["'`]\/api\/osf\/upload-token/;
    const offenders = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".tsx") || f.endsWith(".ts"))
      .filter((f) => callsIt.test(fs.readFileSync(path.join(dir, f), "utf8")));
    expect(offenders).toEqual([]);
  });

  it("the transition sign-in still asks for read-only scope", () => {
    // If this ever changes to the write scope, the fix above stops being necessary — but
    // it would also contradict the term promising this feature deletes nothing.
    const gate = fs.readFileSync(
      path.join(process.cwd(), "src/components/transition/TransitionGate.tsx"),
      "utf8",
    );
    expect(gate).toContain("OSF_READ_SCOPE");
    expect(gate).not.toContain("OSF_UPLOAD_SCOPE");
  });
});
