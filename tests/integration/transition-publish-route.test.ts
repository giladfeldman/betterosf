// Publishing: the one irreversible act in the toolkit.
//
// Every test here is a way a permanent, citable public record could be minted when it
// should not have been — a phrase the client chose for itself, a record belonging to
// somebody else, a run we know is missing files, or a deposit against the wrong Zenodo.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db/require-user", () => ({ requireAppUser: vi.fn() }));
vi.mock("@/lib/db/transition-consents", () => ({
  recordConsent: vi.fn().mockResolvedValue(undefined),
  userHasToolkitConsent: vi.fn().mockResolvedValue(true),
  listToolkitConsents: vi.fn(),
}));
vi.mock("@/lib/db/transition-jobs", () => ({
  getJob: vi.fn(),
  claimPublish: vi.fn(),
  releasePublishClaim: vi.fn(),
  recordPublishedDoi: vi.fn(),
}));
vi.mock("@/lib/transition/targets/zenodo", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/transition/targets/zenodo")>();
  return { ...actual, listDraftFiles: vi.fn(), publishDraft: vi.fn() };
});
vi.mock("@/lib/logger", () => ({
  logEventAwaited: vi.fn().mockResolvedValue(true),
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
}));

const cookieStore = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (cookieStore.has(name) ? { name, value: cookieStore.get(name) } : undefined),
  }),
}));

import { GET, POST } from "@/app/api/transition/publish/route";
import { requireAppUser } from "@/lib/db/require-user";
import { getJob, claimPublish, releasePublishClaim, recordPublishedDoi } from "@/lib/db/transition-jobs";
import { listDraftFiles, publishDraft, ZenodoError } from "@/lib/transition/targets/zenodo";
import { recordConsent } from "@/lib/db/transition-consents";
import { publishConfirmationPhrase } from "@/lib/transition/consent";
import { ZENODO_SESSION_COOKIE, seal } from "@/lib/transition/zenodo-session";

const JOB_ID = "33333333-3333-4333-8333-333333333333";
const SIGNED_IN = { ok: true as const, userId: "u1", osfUserId: "osf1" };

const completeJob = {
  jobId: JOB_ID,
  guid: "abc12",
  destination: "zenodo",
  env: "sandbox",
  status: "complete",
  records: [{ recordId: "555", fileCount: 3 }],
  publishedRecords: [],
  fileCount: 3,
  bytesTotal: 30,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function connect(osfUserId = "osf1", env: "sandbox" | "production" = "sandbox") {
  cookieStore.set(
    ZENODO_SESSION_COOKIE,
    seal({ accessToken: "zen-token", env, scope: "deposit:write", expiresAt: null, osfUserId }),
  );
}

function post(body: unknown): Request {
  return new Request("http://localhost:4747/api/transition/publish", {
    method: "POST",
    headers: { "Content-Type": "application/json", "user-agent": "vitest" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  process.env.AUTH_SECRET = "test-auth-secret-for-sealing-cookies";
  process.env.ZENODO_ENV = "sandbox";
  cookieStore.clear();
  vi.mocked(requireAppUser).mockReset().mockResolvedValue(SIGNED_IN);
  vi.mocked(getJob).mockReset().mockResolvedValue(completeJob);
  vi.mocked(listDraftFiles).mockReset().mockResolvedValue(["a.csv", "b.csv", "c.csv"]);
  vi.mocked(publishDraft)
    .mockReset()
    .mockResolvedValue({ id: "555", links: {}, doi: "10.5072/zenodo.555" });
  vi.mocked(recordConsent).mockReset().mockResolvedValue(undefined);
  vi.mocked(claimPublish).mockReset().mockResolvedValue(true);
  vi.mocked(releasePublishClaim).mockReset().mockResolvedValue(true);
  vi.mocked(recordPublishedDoi).mockReset().mockResolvedValue(undefined);
});

describe("GET /api/transition/publish", () => {
  it("derives the phrase from the draft's real file count", async () => {
    connect();
    const res = await GET(
      new Request(`http://localhost:4747/api/transition/publish?jobId=${JOB_ID}&recordId=555`),
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.fileCount).toBe(3);
    expect(body.phrase).toBe(publishConfirmationPhrase({ fileCount: 3 }));
  });

  it("refuses an empty draft rather than offering a phrase for nothing", async () => {
    connect();
    vi.mocked(listDraftFiles).mockResolvedValue([]);
    const res = await GET(
      new Request(`http://localhost:4747/api/transition/publish?jobId=${JOB_ID}&recordId=555`),
    );
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("empty_draft");
  });
});

describe("POST /api/transition/publish", () => {
  it("publishes when the typed phrase matches the server's own derivation", async () => {
    connect();
    const res = await POST(
      post({ jobId: JOB_ID, recordId: "555", typedPhrase: publishConfirmationPhrase({ fileCount: 3 }) }),
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.doi).toBe("10.5072/zenodo.555");
    expect(publishDraft).toHaveBeenCalledTimes(1);
  });

  it("records consent BEFORE publishing, never after", async () => {
    // The record has to exist before the act it authorises. Written afterwards, a crash
    // mid-publish leaves a permanent DOI with no evidence anyone agreed to it.
    connect();
    const order: string[] = [];
    vi.mocked(recordConsent).mockImplementation(async () => void order.push("consent"));
    vi.mocked(publishDraft).mockImplementation(async () => {
      order.push("publish");
      return { id: "555", links: {}, doi: null };
    });

    await POST(post({ jobId: JOB_ID, recordId: "555", typedPhrase: publishConfirmationPhrase({ fileCount: 3 }) }));
    expect(order).toEqual(["consent", "publish"]);
  });

  it("stores the typed phrase and the count as evidence", async () => {
    connect();
    await POST(post({ jobId: JOB_ID, recordId: "555", typedPhrase: publishConfirmationPhrase({ fileCount: 3 }) }));
    expect(recordConsent).toHaveBeenCalledWith(
      expect.objectContaining({ scope: "publish", jobId: JOB_ID, itemCount: 3 }),
    );
  });

  it("REJECTS a phrase derived from a count the client supplied", async () => {
    // The draft holds three files; a client that computes the phrase itself could type the
    // one-file phrase and publish without ever reading the real number.
    connect();
    const res = await POST(
      post({ jobId: JOB_ID, recordId: "555", typedPhrase: publishConfirmationPhrase({ fileCount: 1 }) }),
    );
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("phrase_mismatch");
    expect(publishDraft).not.toHaveBeenCalled();
  });

  it("re-derives at publish time, so a draft that changed under the dialog fails", async () => {
    connect();
    // The dialog was opened at 3 files; a fourth arrived before the user pressed publish.
    vi.mocked(listDraftFiles).mockResolvedValue(["a", "b", "c", "d"]);
    const res = await POST(
      post({ jobId: JOB_ID, recordId: "555", typedPhrase: publishConfirmationPhrase({ fileCount: 3 }) }),
    );
    expect(res.status).toBe(409);
    expect(publishDraft).not.toHaveBeenCalled();
  });

  it("refuses to publish a run that did not reconcile as complete", async () => {
    connect();
    vi.mocked(getJob).mockResolvedValue({ ...completeJob, status: "incomplete" });
    const res = await POST(
      post({ jobId: JOB_ID, recordId: "555", typedPhrase: publishConfirmationPhrase({ fileCount: 3 }) }),
    );
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("run_not_complete");
    expect(publishDraft).not.toHaveBeenCalled();
  });

  it("refuses a record that is not part of this run", async () => {
    connect();
    const res = await POST(
      post({ jobId: JOB_ID, recordId: "999", typedPhrase: publishConfirmationPhrase({ fileCount: 3 }) }),
    );
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("record_not_in_job");
    expect(publishDraft).not.toHaveBeenCalled();
  });

  it("refuses when the run belongs to somebody else", async () => {
    connect();
    vi.mocked(getJob).mockResolvedValue(null);
    const res = await POST(
      post({ jobId: JOB_ID, recordId: "555", typedPhrase: publishConfirmationPhrase({ fileCount: 3 }) }),
    );
    expect(res.status).toBe(404);
    expect(publishDraft).not.toHaveBeenCalled();
  });

  it("refuses when the Zenodo cookie belongs to a different OSF user", async () => {
    connect("someone-else");
    const res = await POST(
      post({ jobId: JOB_ID, recordId: "555", typedPhrase: publishConfirmationPhrase({ fileCount: 3 }) }),
    );
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("zenodo_not_connected");
    expect(publishDraft).not.toHaveBeenCalled();
  });

  it("refuses to publish a sandbox run against production", async () => {
    process.env.ZENODO_ENV = "production";
    connect("osf1", "production");
    const res = await POST(
      post({ jobId: JOB_ID, recordId: "555", typedPhrase: publishConfirmationPhrase({ fileCount: 3 }) }),
    );
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("env_mismatch");
    expect(publishDraft).not.toHaveBeenCalled();
  });

  it("refuses when the draft now holds fewer files than the run recorded", async () => {
    // Codex review 2026-08-13: the phrase count comes from Zenodo, so a draft somebody
    // emptied after the run would simply produce a smaller phrase and publish cleanly.
    // Cross-checking against what the run recorded for THIS record catches that.
    connect();
    vi.mocked(listDraftFiles).mockResolvedValue(["a.csv"]);
    const res = await POST(
      post({ jobId: JOB_ID, recordId: "555", typedPhrase: publishConfirmationPhrase({ fileCount: 1 }) }),
    );
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("draft_shrank");
    expect(publishDraft).not.toHaveBeenCalled();
  });

  it("allows a draft holding MORE than the run recorded, which the phrase already surfaces", async () => {
    // The supplement bundle is a legitimate extra, and so is anything the researcher added
    // on Zenodo themselves. The count is embedded in the phrase they have to type, so an
    // unexpected number cannot pass unread.
    connect();
    vi.mocked(listDraftFiles).mockResolvedValue(["a.csv", "b.csv", "c.csv", "betterosf-supplement.zip"]);
    const res = await POST(
      post({ jobId: JOB_ID, recordId: "555", typedPhrase: publishConfirmationPhrase({ fileCount: 4 }) }),
    );
    expect(res.status).toBe(200);
  });

  it("refuses anonymously", async () => {
    vi.mocked(requireAppUser).mockResolvedValue({ ok: false, status: 401, error: "nope" });
    const res = await POST(
      post({ jobId: JOB_ID, recordId: "555", typedPhrase: publishConfirmationPhrase({ fileCount: 3 }) }),
    );
    expect(res.status).toBe(401);
    expect(publishDraft).not.toHaveBeenCalled();
  });
});

describe("POST /api/transition/publish — replay (Sonnet review, 2026-08-13)", () => {
  it("refuses a second publish of the same record without calling Zenodo", async () => {
    // Nothing recorded that a record had been published, so a replayed POST went straight
    // back to Zenodo — and what Zenodo does about re-publishing was never measured, unlike
    // every other Zenodo fact this codebase relies on. Publishing mints a permanent DOI.
    connect();
    vi.mocked(claimPublish).mockResolvedValue(false);
    vi.mocked(getJob).mockResolvedValue({
      ...completeJob,
      publishedRecords: [{ recordId: "555", doi: "10.5072/zenodo.555", publishedAt: "2026-08-13T00:00:00Z" }],
    });

    const res = await POST(
      post({ jobId: JOB_ID, recordId: "555", typedPhrase: publishConfirmationPhrase({ fileCount: 3 }) }),
    );

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe("already_published");
    expect(body.doi).toBe("10.5072/zenodo.555");
    expect(publishDraft).not.toHaveBeenCalled();
  });

  it("claims the publish BEFORE Zenodo is called, not after", async () => {
    // Claiming afterwards would leave the window it exists to close.
    connect();
    const order: string[] = [];
    vi.mocked(claimPublish).mockImplementation(async () => {
      order.push("claim");
      return true;
    });
    vi.mocked(publishDraft).mockImplementation(async () => {
      order.push("publish");
      return { id: "555", links: {}, doi: null };
    });

    await POST(post({ jobId: JOB_ID, recordId: "555", typedPhrase: publishConfirmationPhrase({ fileCount: 3 }) }));
    expect(order).toEqual(["claim", "publish"]);
  });

  it("publishes nothing when the claim cannot be recorded at all", async () => {
    connect();
    vi.mocked(claimPublish).mockRejectedValue(new Error("db down"));
    const res = await POST(
      post({ jobId: JOB_ID, recordId: "555", typedPhrase: publishConfirmationPhrase({ fileCount: 3 }) }),
    );
    expect(res.status).toBe(503);
    expect(publishDraft).not.toHaveBeenCalled();
  });
});

// d-baf04b (review R-0164): the claim was taken before calling Zenodo and NEVER released,
// so one failed publish — Zenodo refusing it, say for a missing field — locked that record
// out of BetterOSF for good. A definite failure must release it; an unknown outcome must not.
describe("POST /api/transition/publish — releasing the claim (R-0164)", () => {
  const phrase = () => publishConfirmationPhrase({ fileCount: 3 });

  it("releases the claim when Zenodo definitely refused (4xx), so the user can retry", async () => {
    connect();
    vi.mocked(publishDraft).mockRejectedValue(
      new ZenodoError("400", 400, '{"message":"Missing publisher field required for DOI registration."}'),
    );
    const res = await POST(post({ jobId: JOB_ID, recordId: "555", typedPhrase: phrase() }));
    expect(res.status).toBe(502);
    expect(releasePublishClaim).toHaveBeenCalledWith("osf1", JOB_ID, "555");
    const body = await res.json();
    expect(body.code).toBe("zenodo_error");
  });

  it("releases the claim when consent could not be recorded (Zenodo never called)", async () => {
    connect();
    vi.mocked(recordConsent).mockRejectedValue(new Error("db down"));
    const res = await POST(post({ jobId: JOB_ID, recordId: "555", typedPhrase: phrase() }));
    expect(res.status).toBe(503);
    expect(publishDraft).not.toHaveBeenCalled();
    expect(releasePublishClaim).toHaveBeenCalledWith("osf1", JOB_ID, "555");
  });

  it.each([
    ["a network failure after the request was sent", () => new TypeError("fetch failed")],
    ["a timeout", () => new DOMException("aborted", "AbortError")],
    ["a Zenodo 5xx (it may have published before failing)", () => new ZenodoError("502", 502, "bad gateway")],
  ])("KEEPS the claim on %s and tells the user to check Zenodo before retrying", async (_l, err) => {
    connect();
    vi.mocked(publishDraft).mockRejectedValue(err());
    const res = await POST(post({ jobId: JOB_ID, recordId: "555", typedPhrase: phrase() }));
    expect(releasePublishClaim).not.toHaveBeenCalled();
    const body = await res.json();
    expect(body.code).toBe("publish_outcome_unknown");
    expect(body.error).toMatch(/check .*Zenodo.* before/i);
  });

  it("a claim with no DOI on a retry is reported as an unknown outcome, not as 'already published'", async () => {
    connect();
    vi.mocked(claimPublish).mockResolvedValue(false);
    vi.mocked(getJob).mockResolvedValue({
      ...completeJob,
      publishedRecords: [{ recordId: "555", doi: null, publishedAt: "2026-08-13T00:00:00Z" }],
    });
    const res = await POST(post({ jobId: JOB_ID, recordId: "555", typedPhrase: phrase() }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe("publish_outcome_unknown");
    expect(publishDraft).not.toHaveBeenCalled();
  });

  it("records the DOI on success, so a later retry can name it", async () => {
    connect();
    const res = await POST(post({ jobId: JOB_ID, recordId: "555", typedPhrase: phrase() }));
    expect(res.status).toBe(200);
    expect(recordPublishedDoi).toHaveBeenCalledWith("osf1", JOB_ID, "555", "10.5072/zenodo.555");
    expect(releasePublishClaim).not.toHaveBeenCalled();
  });
});
