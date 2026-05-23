import { env } from "@/lib/env";

/**
 * Returns the OSF API token to use for this request.
 * In Plan 1, anonymous-only: always the app token.
 * Plan 3 will branch on whether the request has an authenticated user.
 */
export function selectToken(): string {
  return env().OSF_APP_TOKEN;
}
