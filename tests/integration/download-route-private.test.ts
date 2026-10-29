/**
 * A signed-in user's PRIVATE file must reach the viewer as its bytes.
 *
 * Found by the local signed-in probe (2026-10-29): the viewer showed OSF's own HTML page
 * instead of a private .txt file. The proxy fetched `osf.io/download/<id>/`, which
 * redirects to files.osf.io — another host — and fetch drops the Authorization header on a
 * cross-host redirect. Without it, OSF answered the private file with a 200 HTML page,
 * which the proxy passed on as if it were the file.
 *
 * Also pinned: a response fetched with the user's own token is never cacheable by a shared
 * cache (it is private data), and the user's token never leaves the OSF allowlist.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../msw/server";
import { auth } from "@/auth";
import { GET } from "@/app/api/files/[guid]/download/route";

const authMock = auth as unknown as { mockResolvedValue: (v: unknown) => void };
const FILE = "https://files.osf.io/v1/resources/ab12c/providers/osfstorage/6ae3557";

function call(u: string) {
  const req = new Request(`http://localhost:4747/api/files/ab12c/download?u=${encodeURIComponent(u)}&name=notes.txt`);
  return GET(req, { params: Promise.resolve({ guid: "ab12c" }) });
}

beforeEach(() => authMock.mockResolvedValue(null));

describe("download proxy, signed-in private file", () => {
  it("keeps the user's token across OSF's redirect and returns the bytes, uncacheable", async () => {
    authMock.mockResolvedValue({ accessToken: "user-tok", osfUserId: "u1" });
    server.use(
      http.get("https://osf.io/download/6ae3557/", () => HttpResponse.redirect(`${FILE}?action=download`, 302)),
      http.get(FILE, ({ request }) =>
        request.headers.get("authorization") === "Bearer user-tok"
          ? new HttpResponse("private bytes", { headers: { "content-type": "application/octet-stream" } })
          : HttpResponse.redirect("https://osf.io/login/?next=x", 302),
      ),
      http.get("https://osf.io/login/", () => new HttpResponse("<html>OSF sign in</html>", { headers: { "content-type": "text/html" } })),
    );
    const res = await call("https://osf.io/download/6ae3557/");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("private bytes");
    const cc = res.headers.get("cache-control") ?? "";
    expect(cc).toMatch(/private|no-store/);
    expect(cc).not.toMatch(/public/);
  });

  it("follows OSF's signed storage redirect WITHOUT the user's token (it never leaves OSF hosts)", async () => {
    // Measured 2026-10-29: files.osf.io answers 302 to a signed object-storage URL on a
    // non-OSF host, and that host rejects a request carrying Authorization (400).
    authMock.mockResolvedValue({ accessToken: "user-tok", osfUserId: "u1" });
    let leaked = false;
    server.use(
      http.get("https://osf.io/download/6ae3557/", () => HttpResponse.redirect(`${FILE}?action=download`, 302)),
      http.get(FILE, ({ request }) =>
        request.headers.get("authorization") === "Bearer user-tok"
          ? HttpResponse.redirect("https://bucket.objectstorage.example.com/signed?sig=abc", 302)
          : new HttpResponse("no", { status: 401 }),
      ),
      http.get("https://bucket.objectstorage.example.com/signed", ({ request }) => {
        leaked = request.headers.get("authorization") !== null;
        return leaked ? new HttpResponse("bad request", { status: 400 }) : new HttpResponse("private bytes");
      }),
    );
    const res = await call("https://osf.io/download/6ae3557/");
    expect(leaked).toBe(false);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("private bytes");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  it("a stale or rate-limited user token still gets a PUBLIC file, fetched anonymously (no user token on the retry)", async () => {
    authMock.mockResolvedValue({ accessToken: "stale-tok", osfUserId: "u1" });
    const seen: (string | null)[] = [];
    server.use(
      http.get(FILE, ({ request }) => {
        const a = request.headers.get("authorization");
        seen.push(a);
        return a ? new HttpResponse("token rejected", { status: 401 }) : new HttpResponse("public bytes");
      }),
    );
    const res = await call(FILE);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("public bytes");
    expect(seen).toEqual(["Bearer stale-tok", null]);
  });
});
