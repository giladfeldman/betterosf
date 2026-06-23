import { beforeEach, describe, expect, it, vi } from "vitest";
import { uploadFileDirect, getUploadToken, clearUploadToken } from "@/lib/upload/direct";
import { OsfWriteError, OSF_MAX_FILE_SIZE } from "@/lib/osf/waterbutler-url";

const TARGET = {
  guid: "ezcuj",
  provider: "osfstorage",
  path: "/Data/",
  listingUrl: "https://api.osf.io/v2/nodes/ezcuj/files/osfstorage/data/",
};

type Call = { url: string; init?: RequestInit };

function makeFetch(routes: {
  token?: () => Response;
  list?: () => Response;
  put?: (call: Call) => Response;
}) {
  const calls: Call[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.includes("/api/osf/upload-token")) return (routes.token ?? (() => Response.json({ token: "tok-1", expiresAt: null })))();
    if (url.includes("/api/files/") && url.includes("/folder")) return (routes.list ?? (() => Response.json({ entries: [] })))();
    if (url.includes("files.osf.io")) return (routes.put ?? (() => Response.json({ data: { id: "f" } })))({ url, init });
    throw new Error(`unexpected fetch: ${url}`);
  });
  vi.stubGlobal("fetch", fn);
  return { fn, calls };
}

function file(name = "hello.txt", size = 5): File {
  const f = new File(["hello"], name, { type: "text/plain" });
  if (size !== 5) Object.defineProperty(f, "size", { value: size });
  return f;
}

describe("uploadFileDirect", () => {
  beforeEach(() => {
    clearUploadToken();
    vi.unstubAllGlobals();
  });

  it("PUTs bytes straight to files.osf.io with the bearer token", async () => {
    const { calls } = makeFetch({});
    await uploadFileDirect(TARGET, file());
    const put = calls.find((c) => c.url.includes("files.osf.io"));
    expect(put).toBeTruthy();
    expect(put!.url).toContain("https://files.osf.io/v1/resources/ezcuj/providers/osfstorage/");
    expect(new URL(put!.url).searchParams.get("name")).toBe("hello.txt");
    expect((put!.init?.headers as Record<string, string>).Authorization).toBe("Bearer tok-1");
    expect(put!.init?.method).toBe("PUT");
    expect(put!.init?.body).toBeInstanceOf(File);
  });

  it("checks for duplicates and refuses to silently overwrite", async () => {
    makeFetch({ list: () => Response.json({ entries: [{ name: "hello.txt" }] }) });
    await expect(uploadFileDirect(TARGET, file())).rejects.toMatchObject({ status: 409, code: "conflict" });
  });

  it("skips the duplicate check when overwrite is set", async () => {
    const { calls } = makeFetch({ list: () => Response.json({ entries: [{ name: "hello.txt" }] }) });
    await uploadFileDirect(TARGET, file(), { overwrite: true });
    expect(calls.some((c) => c.url.includes("/folder"))).toBe(false);
    expect(calls.some((c) => c.url.includes("files.osf.io"))).toBe(true);
  });

  it("rejects files over OSF's 5 GB limit before any network call", async () => {
    const { fn } = makeFetch({});
    await expect(uploadFileDirect(TARGET, file("big.bin", OSF_MAX_FILE_SIZE + 1))).rejects.toMatchObject({ status: 413, code: "too_large" });
    expect(fn).not.toHaveBeenCalled();
  });

  it("caches the token across uploads (one token fetch for two files)", async () => {
    const { calls } = makeFetch({});
    await uploadFileDirect(TARGET, file("a.txt"), { overwrite: true });
    await uploadFileDirect(TARGET, file("b.txt"), { overwrite: true });
    expect(calls.filter((c) => c.url.includes("/api/osf/upload-token")).length).toBe(1);
  });

  it("refetches the token and retries once on a 401 from Waterbutler", async () => {
    let putCount = 0;
    const { calls } = makeFetch({
      put: () => {
        putCount += 1;
        return putCount === 1 ? new Response("nope", { status: 401 }) : Response.json({ data: { id: "f" } });
      },
    });
    await uploadFileDirect(TARGET, file(), { overwrite: true });
    expect(putCount).toBe(2);
    expect(calls.filter((c) => c.url.includes("/api/osf/upload-token")).length).toBe(2);
  });

  it("maps a 413 from Waterbutler to too_large", async () => {
    makeFetch({ put: () => new Response("too big", { status: 413 }) });
    await expect(uploadFileDirect(TARGET, file(), { overwrite: true })).rejects.toMatchObject({ status: 413, code: "too_large" });
  });

  it("surfaces an authorization failure from the token endpoint", async () => {
    makeFetch({ token: () => Response.json({ error: "Enable OSF uploads", code: "forbidden" }, { status: 403 }) });
    await expect(uploadFileDirect(TARGET, file(), { overwrite: true })).rejects.toBeInstanceOf(OsfWriteError);
  });

  it("rejects a non-OSF-Storage destination without leaking the token", async () => {
    const { fn } = makeFetch({});
    await expect(uploadFileDirect({ ...TARGET, provider: "dropbox" }, file(), { overwrite: true })).rejects.toMatchObject({ code: "invalid" });
    expect(fn).not.toHaveBeenCalled();
  });
});

describe("getUploadToken", () => {
  beforeEach(() => {
    clearUploadToken();
    vi.unstubAllGlobals();
  });

  it("forces a refetch when asked", async () => {
    let n = 0;
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ token: `tok-${++n}`, expiresAt: null })));
    expect(await getUploadToken()).toBe("tok-1");
    expect(await getUploadToken()).toBe("tok-1"); // cached
    expect(await getUploadToken({ force: true })).toBe("tok-2");
  });
});
