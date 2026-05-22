import "@testing-library/jest-dom/vitest";
import { afterAll, afterEach, beforeAll } from "vitest";
import { server } from "./msw/server";

// Set env vars BEFORE any test imports env.ts (which caches the parsed env on first call).
// Setting them in a per-test beforeEach is too late — the first test wins forever.
process.env.OSF_APP_TOKEN = "test-token";
process.env.NEXT_PUBLIC_BASE_URL = "http://localhost:3000";

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
