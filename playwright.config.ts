import { defineConfig } from "@playwright/test";

// BetterOSF binds 4747, never the ecosystem-default 3000 — see
// tests/unit/dev-port.test.ts for why (port collisions caused a real
// misdiagnosis when a probe hit a different project's server).
// Written as literals, not a template, so the port stays greppable.
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  use: { baseURL: "http://localhost:4747" },
  webServer: {
    command: "npm run build && npm run start",
    port: 4747,
    reuseExistingServer: !process.env.CI,
  },
});
