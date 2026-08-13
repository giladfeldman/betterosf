// The consent route and the guard that depends on it.
//
// Every test here is a way the gate could wrongly open, or a way a consent record could
// be created that does not reflect what the user actually saw. Both are failures of the
// same kind: evidence that misrepresents what happened.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db/require-user", () => ({ requireAppUser: vi.fn() }));
vi.mock("@/lib/db/transition-consents", () => ({
  recordConsent: vi.fn().mockResolvedValue(undefined),
  userHasToolkitConsent: vi.fn(),
  listToolkitConsents: vi.fn(),
}));
vi.mock("@/lib/logger", () => ({
  logEventAwaited: vi.fn().mockResolvedValue(true),
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
}));

import { GET, POST } from "@/app/api/transition/consent/route";
import { requireAppUser } from "@/lib/db/require-user";
import { recordConsent, userHasToolkitConsent } from "@/lib/db/transition-consents";
import { requireTransitionActor } from "@/lib/transition/guard";
import { TERMS_VERSION, TRANSITION_DIALOG_CLAUSE_IDS } from "@/lib/terms";

const SIGNED_IN = { ok: true as const, userId: "u1", osfUserId: "osf1" };

function post(body: unknown): Request {
  return new Request("http://localhost:4747/api/transition/consent", {
    method: "POST",
    headers: { "Content-Type": "application/json", "user-agent": "vitest" },
    body: JSON.stringify(body),
  });
}

const validBody = {
  termsVersion: TERMS_VERSION,
  clauseIds: [...TRANSITION_DIALOG_CLAUSE_IDS],
};

beforeEach(() => {
  vi.mocked(requireAppUser).mockReset();
  vi.mocked(recordConsent).mockReset().mockResolvedValue(undefined);
  vi.mocked(userHasToolkitConsent).mockReset();
});

describe("GET /api/transition/consent", () => {
  it("reports signed-out without inventing consent", async () => {
    vi.mocked(requireAppUser).mockResolvedValue({ ok: false, status: 401, error: "Sign in" });
    const body = await (await GET()).json();
    expect(body).toMatchObject({ signedIn: false, consented: false });
  });

  it("reports a signed-in user who has not consented", async () => {
    vi.mocked(requireAppUser).mockResolvedValue(SIGNED_IN);
    vi.mocked(userHasToolkitConsent).mockResolvedValue(false);
    const body = await (await GET()).json();
    expect(body).toMatchObject({ signedIn: true, consented: false, termsVersion: TERMS_VERSION });
  });

  it("never caches — consent is per-user state", async () => {
    vi.mocked(requireAppUser).mockResolvedValue(SIGNED_IN);
    vi.mocked(userHasToolkitConsent).mockResolvedValue(true);
    expect((await GET()).headers.get("Cache-Control")).toBe("private, no-store");
  });
});

describe("POST /api/transition/consent", () => {
  it("refuses to record consent for a signed-out caller", async () => {
    vi.mocked(requireAppUser).mockResolvedValue({ ok: false, status: 401, error: "Sign in" });
    const res = await POST(post(validBody));
    expect(res.status).toBe(401);
    expect(recordConsent).not.toHaveBeenCalled();
  });

  it("records consent for a signed-in user", async () => {
    vi.mocked(requireAppUser).mockResolvedValue(SIGNED_IN);
    const res = await POST(post(validBody));
    expect(res.status).toBe(200);
    expect(recordConsent).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "u1", osfUserId: "osf1", scope: "toolkit" }),
    );
  });

  it("rejects a stale tab agreeing to superseded terms", async () => {
    // A tab open across a TERMS_VERSION bump would otherwise record agreement to text
    // that is no longer the terms — evidence of something that never happened.
    vi.mocked(requireAppUser).mockResolvedValue(SIGNED_IN);
    const res = await POST(post({ ...validBody, termsVersion: "2026-08-03" }));
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("terms_version_mismatch");
    expect(recordConsent).not.toHaveBeenCalled();
  });

  it("rejects a submission that displayed fewer clauses than required", async () => {
    vi.mocked(requireAppUser).mockResolvedValue(SIGNED_IN);
    const res = await POST(post({ ...validBody, clauseIds: TRANSITION_DIALOG_CLAUSE_IDS.slice(1) }));
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("incomplete_clauses");
    expect(recordConsent).not.toHaveBeenCalled();
  });

  it("rejects a malformed body", async () => {
    vi.mocked(requireAppUser).mockResolvedValue(SIGNED_IN);
    expect((await POST(post({ termsVersion: TERMS_VERSION }))).status).toBe(400);
    expect((await POST(post({ termsVersion: TERMS_VERSION, clauseIds: [] }))).status).toBe(400);
    expect(recordConsent).not.toHaveBeenCalled();
  });

  it("never trusts a client-supplied terms version as the stored value", async () => {
    // recordConsent stamps TERMS_VERSION itself; the body value is only a staleness check.
    vi.mocked(requireAppUser).mockResolvedValue(SIGNED_IN);
    await POST(post(validBody));
    const arg = vi.mocked(recordConsent).mock.calls[0]![0] as Record<string, unknown>;
    expect(arg).not.toHaveProperty("termsVersion");
  });
});

describe("requireTransitionActor", () => {
  it("is 401 for a signed-out caller", async () => {
    vi.mocked(requireAppUser).mockResolvedValue({ ok: false, status: 401, error: "Sign in" });
    const r = await requireTransitionActor();
    expect(r).toMatchObject({ ok: false, status: 401, code: "unauthorized" });
  });

  it("is 403 consent_required for a signed-in user who has not agreed", async () => {
    // Distinguishable from 401 on purpose: the client shows the clickwrap, not a login.
    vi.mocked(requireAppUser).mockResolvedValue(SIGNED_IN);
    vi.mocked(userHasToolkitConsent).mockResolvedValue(false);
    const r = await requireTransitionActor();
    expect(r).toMatchObject({ ok: false, status: 403, code: "consent_required" });
  });

  it("passes only when signed in AND consented", async () => {
    vi.mocked(requireAppUser).mockResolvedValue(SIGNED_IN);
    vi.mocked(userHasToolkitConsent).mockResolvedValue(true);
    expect(await requireTransitionActor()).toMatchObject({
      ok: true,
      actor: { userId: "u1", osfUserId: "osf1" },
    });
  });

  it("never turns a thrown consent lookup into access", async () => {
    // Propagating (→ 500) is fine; returning ok:true is not. The real fail-closed
    // behaviour lives in userHasToolkitConsent's catch and is covered directly in
    // tests/unit/transition-consent-fail-closed.test.ts, because mocking the wrapper
    // here would mock away the very thing worth testing.
    vi.mocked(requireAppUser).mockResolvedValue(SIGNED_IN);
    vi.mocked(userHasToolkitConsent).mockRejectedValue(new Error("neon down"));
    await expect(requireTransitionActor()).rejects.toThrow();
  });
});
