import { defineConfig, devices } from "@playwright/test";

/**
 * Dedicated Playwright config for post-deploy probes. Does NOT start a dev
 * server — probes run against the live BASE_URL passed as an env var.
 *
 * BetterOSF runs ANONYMOUS Tier-1 probes only: it has no database, no
 * role-gated pages, and its auth is OSF OAuth (no test-login backdoor). A real
 * browser is used (not curl) so probes pass Vercel's bot-challenge / Attack
 * Challenge Mode, which blocks headless HTTP clients on production.
 */
export default defineConfig({
  testDir: ".",
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [["list"], ["json", { outputFile: "post-deploy-report.json" }]],
  timeout: 45_000,
  use: {
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
