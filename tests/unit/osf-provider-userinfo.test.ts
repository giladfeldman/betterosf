/**
 * The sign-in step that was failing in production, 2026-08-13.
 *
 * Reported as: approve on osf.io → land on `/api/auth/error?error=Configuration` → a black
 * "Server error / Check the server logs" box. The Vercel log said only
 * `Error: OSF userinfo failed: 401`, because that is all the code threw away everything
 * else to say.
 *
 * `error=Configuration` is Auth.js's catch-all for any server-side callback failure, so the
 * name actively misleads: nothing was misconfigured. These tests pin that each distinct
 * cause is now distinguishable from the others.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { osfProvider } from "@/lib/auth/osf-provider";

type UserinfoRequest = (arg: {
  tokens: { access_token?: string; scope?: string; token_type?: string };
}) => Promise<unknown>;

function requestFn(): UserinfoRequest {
  const provider = osfProvider({ clientId: "id", clientSecret: "secret" });
  const userinfo = provider.userinfo as { request: UserinfoRequest };
  return userinfo.request;
}

const profileBody = { data: { id: "abc12", type: "users", attributes: { full_name: "A Researcher" } } };

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("userinfo", () => {
  it("returns the profile on success", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(profileBody), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(requestFn()({ tokens: { access_token: "tok" } })).resolves.toEqual(profileBody);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![1].headers.Authorization).toBe("Bearer tok");
  });

  it("blames US, not OSF, when the exchange returned no token at all", async () => {
    // `Bearer undefined` would have produced a 401 and been reported as an OSF problem —
    // sending the user to re-authorise an account that was never the issue.
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(requestFn()({ tokens: {} })).rejects.toThrow(/BetterOSF bug/i);
    // And it does not waste a request proving it.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("retries once on 401, because a fresh OSF token can briefly not exist yet", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(profileBody), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(requestFn()({ tokens: { access_token: "tok" } })).resolves.toEqual(profileBody);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("says out loud when a retry rescued a sign-in", async () => {
    // "It works if you try twice" is a finding about OSF, not a fix. If this stops being
    // logged, the next person cannot tell a healthy sign-in from a flaky one.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response("", { status: 401 }))
        .mockResolvedValueOnce(new Response(JSON.stringify(profileBody), { status: 200 })),
    );

    await requestFn()({ tokens: { access_token: "tok" } });
    expect(warn.mock.calls.flat().join(" ")).toMatch(/propagation lag|retry/i);
  });

  it("does not retry forever — two 401s is a refusal, and it says what to do", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("nope", { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(requestFn()({ tokens: { access_token: "tok" } })).rejects.toThrow(
      /issued a token and then refused it/i,
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry a non-401 — a 500 is not a propagation lag", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("boom", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(requestFn()({ tokens: { access_token: "tok" } })).rejects.toThrow(/returned 500/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("logs what would explain the failure, and never the credential itself", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("upstream detail", { status: 401 })));

    await expect(
      requestFn()({ tokens: { access_token: "super-secret-token", scope: "osf.full_read" } }),
    ).rejects.toThrow();

    const logged = error.mock.calls.flat().join(" ");
    expect(logged).toContain("osf.full_read");
    expect(logged).toContain("upstream detail");
    expect(logged).toMatch(/tokenLength/);
    // The one thing that must never reach a log.
    expect(logged).not.toContain("super-secret-token");
  });
});
