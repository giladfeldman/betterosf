import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  esbuild: {
    jsx: "automatic",
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.{ts,tsx}"],
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
