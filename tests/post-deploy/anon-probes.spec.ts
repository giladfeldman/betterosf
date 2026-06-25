/**
 * Post-deploy anonymous probe spec. Scaffolded by the post-deploy-verify skill,
 * tailored for BetterOSF (public OSF browser — no DB, no roles, OSF OAuth).
 *
 * Runs against the live BASE_URL in a REAL browser (Playwright), so it passes
 * Vercel's bot-challenge / Attack Challenge Mode that blocks headless HTTP
 * clients like curl on production. Two checks:
 *   1. Liveness  — the deployment is routing traffic.
 *   2. Render    — every public page loads without a 5xx or a crash marker.
 *
 * Edit tests/post-deploy/_routes.ts to add/remove public routes.
 */
import { test, expect } from "@playwright/test";
import { ANON_ROUTES, CRASH_MARKERS } from "./_routes";

const BASE_URL = process.env.BASE_URL;
if (!BASE_URL) throw new Error("BASE_URL env var required");

test.describe("post-deploy: tier 1 — liveness", () => {
  test("deployment is serving traffic", async ({ page }) => {
    // Poll up to 30s for the deployment to warm up. A real browser navigation is
    // used (not request.get) so Vercel's challenge is solved client-side.
    const started = Date.now();
    let lastStatus = 0;
    while (Date.now() - started < 30_000) {
      try {
        const res = await page.goto(`${BASE_URL}/`, { waitUntil: "domcontentloaded" });
        lastStatus = res?.status() ?? 0;
        if (lastStatus > 0 && lastStatus < 500) return;
      } catch {
        /* still warming */
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    throw new Error(`/ did not return < 500 within 30s (last status ${lastStatus})`);
  });
});

test.describe("post-deploy: tier 2 — anonymous render", () => {
  for (const route of ANON_ROUTES) {
    test(`anon → ${route.label} (${route.path})`, async ({ page }) => {
      const res = await page.goto(`${BASE_URL}${route.path}`, {
        waitUntil: "domcontentloaded",
      });
      expect(res?.status(), `status on ${route.path}`).toBeLessThan(500);
      const html = await page.content();
      for (const marker of CRASH_MARKERS) {
        expect(
          html,
          `${route.label} (${route.path}) contained crash marker ${JSON.stringify(marker)}`,
        ).not.toContain(marker);
      }
    });
  }
});
