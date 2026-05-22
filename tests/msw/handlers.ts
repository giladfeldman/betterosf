import type { HttpHandler } from "msw";

// Start with no default handlers — each test declares the OSF endpoints it touches
// via server.use(...). Combined with onUnhandledRequest: "error" this surfaces any
// test that forgot to mock something.
export const handlers: HttpHandler[] = [];
