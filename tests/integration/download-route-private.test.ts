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

  it("never follows a redirect off the OSF allowlist with the user's token", async () => {
    authMock.mockResolvedValue({ accessToken: "user-tok", osfUserId: "u1" });
    let leaked = false;
    server.use(
      http.get("https://osf.io/download/6ae3557/", () => HttpResponse.redirect("https://evil.example.com/steal", 302)),
      http.get("https://evil.example.com/steal", ({ request }) => {
        leaked = request.headers.get("authorization") !== null;
        return new HttpResponse("x");
      }),
    );
    const res = await call("https://osf.io/download/6ae3557/");
    expect(leaked).toBe(false);
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});
