import "server-only";
import { selectToken } from "./tokens";
import { OsfError } from "./types";
import { incrementDaily } from "@/lib/limits";
import { auth } from "@/auth";

const OSF_API_BASE = "https://api.osf.io/v2";

async function authHeaders(): Promise<HeadersInit> {
  return {
    Authorization: `Bearer ${await selectToken()}`,
    Accept: "application/vnd.api+json",
  };
}

const ANON_HEADERS: HeadersInit = {
  Accept: "application/vnd.api+json",
};

function mapError(status: number, body: string): OsfError {
  if (status === 404) return new OsfError(404, "not_found", "OSF resource not found");
  if (status === 403) return new OsfError(403, "forbidden", "Access to this OSF resource is forbidden");
  if (status === 401) return new OsfError(401, "forbidden", "OSF authentication required");
  if (status === 429) return new OsfError(429, "rate_limited", "OSF rate limit exceeded");
  if (status >= 500) return new OsfError(status, "upstream", `OSF upstream error ${status}`);
  return new OsfError(status, "unknown", `OSF returned ${status}: ${body.slice(0, 200)}`);
}

export async function osfGet<T = unknown>(
  path: string,
  init?: { revalidate?: number; tags?: string[] }
): Promise<T> {
  const url = `${OSF_API_BASE}${path}`;
  return osfGetUrl<T>(url, init);
}

export async function osfGetUrl<T = unknown>(
  url: string,
  init?: { revalidate?: number; tags?: string[] }
): Promise<T> {
  // Track app-token quota usage when no user session.
  // Per-user OAuth requests consume the USER'S quota, not ours.
  try {
    const session = await auth();
    if (!session?.accessToken) {
      const today = new Date().toISOString().slice(0, 10);
      void incrementDaily(`app:osf:calls:${today}`);
    }
  } catch {
    // auth() may throw in non-request contexts; count as anonymous
    const today = new Date().toISOString().slice(0, 10);
    void incrementDaily(`app:osf:calls:${today}`);
  }

  const next = { revalidate: init?.revalidate ?? 300, tags: init?.tags };
  let res = await fetch(url, {
    headers: await authHeaders(),
    next,
  });

  // OSF public endpoints do not require a bearer token. If the app-owned PAT is
  // expired or revoked, anonymous public browsing should still work instead of
  // throwing a route-level 401.
  if (res.status === 401 || res.status === 403) {
    const anonymousRes = await fetch(url, {
      headers: ANON_HEADERS,
      next,
    });
    if (anonymousRes.ok) res = anonymousRes;
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw mapError(res.status, body);
  }
  return (await res.json()) as T;
}
