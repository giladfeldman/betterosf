/**
 * Visual QA: drive a headless Chromium through the major BetterOSF pages on
 * production, screenshot each, and run a few interactive checks. Outputs PNGs
 * to ./screenshots/ for human (or LLM) review.
 *
 * Usage:
 *   node tests/visual/visual-qa.mjs
 *
 * Optional env:
 *   BETTEROSF_URL — base URL (default https://betterosf.vercel.app)
 *   COLOR_SCHEME  — "light" | "dark" (default "dark")
 */
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";

const BASE = process.env.BETTEROSF_URL ?? "https://betterosf.vercel.app";
const COLOR = (process.env.COLOR_SCHEME ?? "dark").toLowerCase();
const OUT = "./screenshots";

// Long-running project with many components/folders for tree depth checks
const HEAVY_GUID = "3kmr9";
// Many Labs 2 — has components + folders + registrations
const MANY_LABS_GUID = "8cd4r";

const PAGES = [
  { name: "01-landing", url: "/" },
  { name: "02-login", url: "/login" },
  { name: "03-search-empty", url: "/search" },
  { name: "04-search-replication", url: "/search?q=replication&type=projects" },
  { name: "05-search-or-syntax", url: "/search?q=replication%20OR%20meta-analysis&type=projects" },
  { name: "06-search-files", url: "/search?q=raw.csv&type=files" },
  { name: "07-search-registrations", url: "/search?q=preregistration&type=registrations" },
  { name: "08-search-users", url: "/search?q=feldman&type=users" },
  { name: "09-project-manylabs2", url: `/${MANY_LABS_GUID}` },
  { name: "10-project-heavy-linked", url: `/${HEAVY_GUID}` },
  { name: "11-files-tree-manylabs2", url: `/${MANY_LABS_GUID}/files` },
  { name: "12-files-tree-heavy", url: `/${HEAVY_GUID}/files` },
  { name: "13-deep-folder", url: `/${MANY_LABS_GUID}/files/osfstorage` },
  { name: "14-registrations-compare", url: "/registrations/compare?a=m9w53&b=m9w53" },
  { name: "15-me-redirect", url: "/me" },
  { name: "16-about", url: "/about" },
  { name: "17-privacy", url: "/privacy" },
  { name: "18-404", url: "/notarealroute/files" },
];

async function main() {
  await mkdir(OUT, { recursive: true });

  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    colorScheme: COLOR === "light" ? "light" : "dark",
  });
  const page = await ctx.newPage();

  const collected = [];

  for (const { name, url } of PAGES) {
    const full = BASE + url;
    process.stdout.write(`[${name}] ${url} ... `);
    let status = "?";
    let consoleErrors = [];
    page.removeAllListeners("console");
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text().slice(0, 200));
    });
    try {
      const resp = await page.goto(full, { waitUntil: "domcontentloaded", timeout: 30_000 });
      status = String(resp?.status() ?? "no-resp");
      // Give RSC hydration a beat + skeleton calls a chance to land
      await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
      await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
      console.log(`${status} (${consoleErrors.length} console errors)`);
    } catch (e) {
      console.log(`ERR ${e instanceof Error ? e.message.slice(0, 100) : e}`);
    }
    collected.push({ name, url, status, consoleErrors });
  }

  // --- Interactive checks ---
  console.log("\n--- Interactive checks ---");

  // 1) Files tree on Many Labs 2: click "Expand all", confirm files appear
  await page.goto(`${BASE}/${MANY_LABS_GUID}/files`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
  await page.screenshot({ path: `${OUT}/INT-01-files-before-expand-all.png`, fullPage: true });
  const expandAll = page.getByRole("button", { name: /expand all/i }).first();
  if (await expandAll.count()) {
    await expandAll.click();
    await page.waitForTimeout(3000); // give fetches time
    await page.screenshot({ path: `${OUT}/INT-02-files-after-expand-all.png`, fullPage: true });
    console.log("- expand-all clicked + screenshot");
  } else {
    console.log("- expand-all button NOT FOUND (issue)");
  }

  // 2) Theme toggle: cycle through and screenshot each
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  const light = page.getByRole("radio", { name: /light theme/i });
  const dark = page.getByRole("radio", { name: /dark theme/i });
  if (await light.count()) {
    await light.click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/INT-03-theme-light.png` });
    await dark.click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/INT-04-theme-dark.png` });
    console.log("- theme toggle screenshots");
  } else {
    console.log("- theme toggle radio NOT FOUND (issue)");
  }

  // 3) Search keyword highlighting visible?
  await page.goto(`${BASE}/search?q=replication&type=projects`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
  const markCount = await page.locator("mark").count();
  console.log(`- search highlighting: ${markCount} <mark> elements on /search?q=replication`);
  await page.screenshot({ path: `${OUT}/INT-05-search-highlight.png`, fullPage: true });

  // 4) Click a folder in the tree and confirm files appear inline (no navigation)
  await page.goto(`${BASE}/${MANY_LABS_GUID}/files`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
  const folderLink = page.locator('a[href*="/files/osfstorage/"]').first();
  if (await folderLink.count()) {
    const folderUrl = await folderLink.getAttribute("href");
    await folderLink.click();
    await page.waitForTimeout(1500);
    const afterUrl = page.url();
    const navigatedAway = !afterUrl.endsWith(`/${MANY_LABS_GUID}/files`) && !afterUrl.includes("/files?");
    console.log(`- folder click: target=${folderUrl} → ${navigatedAway ? "navigated to " + afterUrl : "stayed on /files (inline expand)"}`);
    await page.screenshot({ path: `${OUT}/INT-06-folder-click.png`, fullPage: true });
  } else {
    console.log("- no folder link found in tree");
  }

  await browser.close();

  console.log("\n--- Summary ---");
  for (const c of collected) {
    console.log(`${c.status.padStart(3)} ${c.name.padEnd(34)} ${c.consoleErrors.length > 0 ? "console-errors:" + c.consoleErrors.length : ""}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
