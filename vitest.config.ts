import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  // Vite 8 transforms with oxc, not esbuild: the old `esbuild.jsx` option is ignored there.
  oxc: {
    jsx: { runtime: "automatic" },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/unit/**/*.test.{ts,tsx}", "tests/integration/**/*.test.{ts,tsx}"],
    // d-2a878c / d-d75681: a full run timed out a different handful of jsdom and route tests
    // each time (9 on 2026-11-16; each passes alone). The cause is load, not the code: the first
    // test in a file pays the cold import of its route or component, and with one worker per core
    // on a shared machine that took over the 5 s default. Workers come from the machine queue's
    // width (LOADQ_WIDTH), never the core count, and the per-test budget covers a cold import.
    maxWorkers: Math.max(1, Number(process.env.LOADQ_WIDTH) || 4),
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
  resolve: {
    // Array form so we can order entries: `@/auth` must match before the generic `@`
    // alias, otherwise tests pull in next-auth (which fails to resolve `next/server`
    // under Vitest). Individual tests can still override with `vi.mock("@/auth", ...)`.
    alias: [
      { find: /^@\/auth$/, replacement: path.resolve(__dirname, "tests/stubs/auth.ts") },
      { find: /^@\//, replacement: path.resolve(__dirname, "src") + "/" },
      { find: "server-only", replacement: path.resolve(__dirname, "node_modules/next/dist/compiled/server-only/empty.js") },
    ],
  },
});
