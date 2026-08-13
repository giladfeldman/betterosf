import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Live probes that talk to REAL third-party services.
 *
 * A separate config, and a separate `include`, so these can never be swept into
 * `npm test`. The main `vitest.config.ts` only globs `tests/unit` and
 * `tests/integration`; nothing under `tests/live` is reachable from it.
 *
 * Same posture as `npm run test:destructive`: opt-in by environment variable, sandbox
 * only, never wired into /ship or CI.
 */
export default defineConfig({
  esbuild: { jsx: "automatic" },
  test: {
    environment: "node",
    include: ["tests/live/**/*.live.test.ts"],
    // A real round trip over the network needs more than the default 5 s.
    testTimeout: 120_000,
    hookTimeout: 120_000,
    // Sequential: these create and delete real records.
    fileParallelism: false,
  },
  resolve: {
    alias: [
      { find: /^@\/auth$/, replacement: path.resolve(__dirname, "tests/stubs/auth.ts") },
      { find: /^@\//, replacement: path.resolve(__dirname, "src") + "/" },
      {
        find: "server-only",
        replacement: path.resolve(__dirname, "node_modules/next/dist/compiled/server-only/empty.js"),
      },
    ],
  },
});
