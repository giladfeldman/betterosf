import "server-only";
import { selectToken } from "./tokens";
import { OsfError } from "./types";

const OSF_API_BASE = "https://api.osf.io/v2";

function authHeaders(): HeadersInit {
  return {
    Authorization: `Bearer ${selectToken()}`,
    Accept: "application/vnd.api+json",
  };
}

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
  const res = await fetch(url, {
    headers: authHeaders(),
    next: {
      revalidate: init?.revalidate ?? 300,
      tags: init?.tags,
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw mapError(res.status, body);
  }
  return (await res.json()) as T;
}
