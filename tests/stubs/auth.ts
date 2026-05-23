// Vitest stub for `@/auth` — avoids importing next-auth (which fails to resolve `next/server`
// under vitest). Tests that exercise auth-aware code use `vi.mock("@/auth", ...)` to override.
import { vi } from "vitest";

export const auth = vi.fn(async () => null);
export const signIn = vi.fn(async () => {});
export const signOut = vi.fn(async () => {});
export const handlers = { GET: async () => new Response(null), POST: async () => new Response(null) };
