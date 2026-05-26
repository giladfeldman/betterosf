/**
 * Visual QA: drive a headless Chromium through every major BetterOSF page
 * AND every UX promise. Beyond screenshots, it CLICKS things and asserts
 * outcomes — the gap that lets bugs through with green test suites.
 *
 * Returns exit code 1 if any required check fails. Suitable for /ship gating.
 *
 * Usage:
 *   node tests/visual/visual-qa.mjs
 *   node tests/visual/visual-qa.mjs --base-url=https://betterosf-pr-12.vercel.app
 *   BASE_URL=https://localhost:3000 node tests/visual/visual-qa.mjs
 *
 * Base URL resolution (highest to lowest priority):
 *   1. --base-url=<url> or --base-url <url> CLI flag
 *   2. BASE_URL env var
 *   3. BETTEROSF_URL env var (legacy, kept for back-compat)
 *   4. https://betterosf.vercel.app (default)
 *
 * Optional env:
 *   COLOR_SCHEME — "light" | "dark" (default "dark")
 *   STRICT       — "1" to exit 1 on any failed check (default "1")
 *   SKIP_VISUAL_QA — "1" to skip entirely (rare; used by /ship dry-run)
 */
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";

function parseBaseUrl(argv) {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--base-url=")) return a.slice("--base-url=".length);
    if (a === "--base-url" && i + 1 < argv.length) return argv[i + 1];
  }
  return null;
}

const BASE =
  parseBaseUrl(process.argv.slice(2)) ??
  process.env.BASE_URL ??
  process.env.BETTEROSF_URL ??
  "https://betterosf.vercel.app";
const COLOR = (process.env.COLOR_SCHEME ?? "dark").toLowerCase();
const STRICT = process.env.STRICT !== "0";
const OUT = "./screenshots";

// Well-known fixtures we lean on for click-through tests. If OSF removes any
// of these the script needs an update — but using stable canonical projects
// keeps the script useful without per-run hand-tuning.
const HEAVY_GUID = "3kmr9";          // PCIRR project with folders that contain SPACES — regression fixture
const MANY_LABS_GUID = "8cd4r";      // Many Labs 2 — components + registrations + folders + sizable
const REG_PARENT_GUID = "3kmr9";     // 3kmr9 has registration ujyh9 — used for registration-expand test

const checks = [];
function record(name, ok, detail = "") {
  checks.push({ name, ok, detail });
  const tag = ok ? "PASS" : "FAIL";
  const dot = ok ? "·" : "✗";
  console.log(`  ${dot} [${tag}] ${name}${detail ? " — " + detail : ""}`);
}

const PAGES = [
  { name: "01-landing", url: "/" },
  { name: "02-login", url: "/login" },
  { name: "03-search-empty", url: "/search" },
  { name: "04-search-replication", url: "/search?q=replication&type=projects" },
  { name: "05-search-or-syntax", url: "/search?q=replication%20OR%20meta-analysis&type=projects" },
  { name: "06-search-files-raw", url: "/search?q=raw.csv&type=files" },
  { name: "06b-search-files-dotqsf", url: "/search?q=.qsf&type=files" },
  { name: "07-search-registrations", url: "/search?q=preregistration&type=registrations" },
  { name: "08-search-users", url: "/search?q=feldman&type=users" },
  { name: "08b-search-in-project", url: `/search?q=Newman&scope=project:${HEAVY_GUID}&type=projects` },
  { name: "08c-search-in-project-files", url: `/search?q=docx&scope=project:${HEAVY_GUID}&type=files` },
  { name: "09-project-manylabs2", url: `/${MANY_LABS_GUID}` },
  { name: "10-project-heavy-linked", url: `/${HEAVY_GUID}` },
  { name: "11-files-tree-manylabs2", url: `/${MANY_LABS_GUID}/files` },
  { name: "12-files-tree-heavy", url: `/${HEAVY_GUID}/files` },
  { name: "13-deep-folder", url: `/${MANY_LABS_GUID}/files/osfstorage` },
  { name: "13b-deep-folder-with-spaces", url: `/${HEAVY_GUID}/files/osfstorage/PCIRR%20Stage%202/PCIRR%20S2%20submission` },
  { name: "14-registrations-compare", url: "/registrations/compare?a=m9w53&b=m9w53" },
  { name: "15-me-redirect", url: "/me" },
  { name: "16-about", url: "/about" },
  { name: "17-privacy", url: "/privacy" },
  { name: "18-404", url: "/notarealroute/files" },
];

async function main() {
  if (process.env.SKIP_VISUAL_QA === "1") {
    console.log("SKIP_VISUAL_QA=1 — skipping visual-qa run.");
    return;
  }
  console.log(`Visual QA against ${BASE} (color=${COLOR}, strict=${STRICT})`);
  await mkdir(OUT, { recursive: true });

  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    colorScheme: COLOR === "light" ? "light" : "dark",
  });
  const page = await ctx.newPage();

  const collected = [];

  // --- 1) Each page renders, returns 200, no console errors ---
  console.log("\n--- Per-page status + console-error gate ---");
  for (const { name, url } of PAGES) {
    const full = BASE + url;
    let status = "?";
    const consoleErrors = [];
    page.removeAllListeners("console");
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text().slice(0, 200));
    });
    try {
      const resp = await page.goto(full, { waitUntil: "domcontentloaded", timeout: 30_000 });
      status = String(resp?.status() ?? "no-resp");
      await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
      await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
    } catch (e) {
      status = `ERR ${e instanceof Error ? e.message.slice(0, 80) : e}`;
    }
    const expect200 = !name.startsWith("18-404") && !name.startsWith("15-me"); // /me redirects, 18 expects 404 page
    const httpOk = expect200 ? status === "200" : true;
    const consoleOk = consoleErrors.length === 0;
    record(`${name} HTTP ${status}`, httpOk);
    if (!consoleOk) record(`${name} console errors`, false, `${consoleErrors.length}: ${consoleErrors[0] ?? ""}`);
    collected.push({ name, url, status, consoleErrors });
  }

  // --- 2) Theme toggle actually changes <body> background (not just html.class) ---
  // Tailwind v4 emits OKLCH so a literal "rgb(255,…)" assertion is wrong. The
  // robust check: sample bg color in dark mode AND light mode, assert the two
  // differ. If they're identical, the `dark:` variant isn't being applied
  // even though `class="dark"` is toggling — exactly the @custom-variant bug
  // we fixed 2026-05-26.
  console.log("\n--- Theme toggle verification (DOM-level, not just visual) ---");
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  const light = page.getByRole("radio", { name: /light theme/i });
  const dark = page.getByRole("radio", { name: /dark theme/i });
  if (await light.count()) {
    await dark.click();
    await page.waitForTimeout(400);
    const darkBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    await page.screenshot({ path: `${OUT}/INT-04-theme-dark.png` });

    await light.click();
    await page.waitForTimeout(400);
    const lightBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    await page.screenshot({ path: `${OUT}/INT-03-theme-light.png` });

    const themeChanges = lightBg !== darkBg;
    record(
      "theme: light vs dark mode produce different body bg-color (Tailwind dark: variant actually applied)",
      themeChanges,
      `dark=${darkBg} light=${lightBg}`
    );

    // Verify the toggle also persists on a deep page (was only smoke-tested on landing before).
    // Pre-condition: we're in light mode here from the click above.
    await page.goto(`${BASE}/${MANY_LABS_GUID}/files`, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
    const filesLightBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    const filesPersistsLight = filesLightBg === lightBg;
    record("theme: light mode persists to /files page", filesPersistsLight, `files=${filesLightBg} expected=${lightBg}`);
  } else {
    record("theme toggle radio present", false, "Light/Dark radios not found");
  }

  // --- 3) Click a file in the tree → preview shows in right pane ---
  console.log("\n--- File-click-from-tree → right-pane preview ---");
  await page.goto(`${BASE}/${MANY_LABS_GUID}/files`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
  // Expand all so file leaves appear in the tree
  const expandAll = page.getByRole("button", { name: /expand all/i }).first();
  if (await expandAll.count()) {
    await expandAll.click();
    await page.waitForTimeout(2500);
  }
  // Find first file leaf — anchor pointing at /files/view/...
  const fileLeaf = page.locator('[role="tree"] a[href*="/files/view/"]').first();
  if (await fileLeaf.count()) {
    const href = await fileLeaf.getAttribute("href");
    const target = await fileLeaf.getAttribute("target");
    record("tree file leaves stay in same tab (target != _blank)", target !== "_blank", `target=${target}`);
    await fileLeaf.click();
    await page.waitForTimeout(3000);
    const url = page.url();
    const onFileView = url.includes("/files/view/");
    record("clicking a tree file leaf navigates to /files/view/...", onFileView, href ?? "");
    // The file-view page should render the viewer, not the "Project not found" message
    const bodyText = (await page.textContent("body")) ?? "";
    const isNotFoundLeak = bodyText.includes("Project not found");
    record("tree file click does NOT land on 'Project not found'", !isNotFoundLeak);
    await page.screenshot({ path: `${OUT}/INT-06-tree-file-click.png`, fullPage: true });
  } else {
    record("tree has at least one clickable file leaf", false, "no a[href*='/files/view/'] inside [role=tree]");
  }

  // --- 4) File-view URL with SPACES in path resolves (not "Project not found") ---
  console.log("\n--- File-view URL with spaces in path ---");
  const spacedUrl = `/${HEAVY_GUID}/files/view/osfstorage/PCIRR%20Stage%202/PCIRR%20S2%20submission/PCIRR-S2-Newman-etal-2011-replication-cover-letter.docx`;
  const spacedResp = await page.goto(BASE + spacedUrl, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => null);
  const spacedStatus = spacedResp?.status() ?? 0;
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
  const spacedBody = (await page.textContent("body").catch(() => "")) ?? "";
  const spacedNotFound = spacedBody.includes("Project not found");
  record(`/files/view URL with %20-encoded spaces: HTTP ${spacedStatus}`, spacedStatus === 200);
  record("/files/view URL with spaces does NOT show 'Project not found'", !spacedNotFound);
  await page.screenshot({ path: `${OUT}/INT-07-spaced-fileview.png`, fullPage: true });

  // --- 5) Search with file-extension query returns results ---
  console.log("\n--- Search edge cases ---");
  await page.goto(`${BASE}/search?q=.qsf&type=files`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
  const qsfBody = (await page.textContent("body")) ?? "";
  const qsfHasNoResults = qsfBody.includes("No results.");
  const qsfHasFiles = qsfBody.toLowerCase().includes(".qsf");
  record("search '.qsf' &type=files returns results (regression: filter[name]= 404 → no results)", !qsfHasNoResults && qsfHasFiles, qsfHasNoResults ? "No-results banner shown" : "");
  await page.screenshot({ path: `${OUT}/INT-08-search-qsf.png`, fullPage: true });

  // Search-in-project (the user said this "doesn't quite work")
  await page.goto(`${BASE}/search?q=docx&scope=project:${HEAVY_GUID}&type=files`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
  const sipBody = (await page.textContent("body")) ?? "";
  const sipHasInThisProject = sipBody.includes("match in this project") || sipBody.includes("walked up to");
  record("search-in-project (files) renders project-scoped UI", sipHasInThisProject);
  await page.screenshot({ path: `${OUT}/INT-09-search-in-project-files.png`, fullPage: true });

  // --- 6) Registrations expand in tree ---
  console.log("\n--- Registrations expandable in tree ---");
  await page.goto(`${BASE}/${REG_PARENT_GUID}/files`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
  // Click the "Registrations" group header to expand it
  const regsRoot = page.locator('[role="treeitem"]', { hasText: /^Registrations \(/i }).first();
  if (await regsRoot.count()) {
    await regsRoot.click();
    await page.waitForTimeout(800);
    // After expansion, there should be at least one row labelled "registration" kind
    const regCount = await page.locator('[role="treeitem"] a[href*="/registrations/"]').count();
    record(`registrations section expanded — N registration rows visible: ${regCount}`, regCount > 0);

    // Click the first registration row to expand its sub-tree (registrations should now be expandable)
    const firstReg = page.locator('[role="treeitem"] a[href*="/registrations/"]').first();
    if (await firstReg.count()) {
      await firstReg.click({ modifiers: [] }); // plain left click → toggle expand
      await page.waitForTimeout(2500);
      // Expanded registration should reveal at least one provider row (osfstorage)
      const providerRows = await page.locator('[role="treeitem"]', { hasText: /^osfstorage/i }).count();
      record(`registration sub-tree expands to show provider rows (osfstorage count): ${providerRows}`, providerRows > 0);
    }
    await page.screenshot({ path: `${OUT}/INT-10-registrations-expanded.png`, fullPage: true });
  } else {
    record("registrations group is present in the tree", false);
  }

  // --- 7) Folder click on /files page stays inline (existing test, kept) ---
  console.log("\n--- Folder click inline-expand (existing) ---");
  await page.goto(`${BASE}/${MANY_LABS_GUID}/files`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
  const folderLink = page.locator('[role="tree"] a[href*="/files/osfstorage/"]').first();
  if (await folderLink.count()) {
    const beforeUrl = page.url();
    await folderLink.click();
    await page.waitForTimeout(800);
    const stayed = page.url() === beforeUrl;
    record("folder left-click expands inline (URL unchanged)", stayed);
  }

  // --- 8) Search keyword highlighting (existing) ---
  console.log("\n--- Search highlighting (existing) ---");
  await page.goto(`${BASE}/search?q=replication&type=projects`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
  const markCount = await page.locator("mark").count();
  record(`search highlighting: ${markCount} <mark> elements`, markCount > 0);

  await browser.close();

  // --- Summary ---
  console.log("\n--- HTTP summary ---");
  for (const c of collected) {
    console.log(`${String(c.status).padStart(3)} ${c.name.padEnd(34)} ${c.consoleErrors.length > 0 ? "console-errors:" + c.consoleErrors.length : ""}`);
  }

  const failures = checks.filter((c) => !c.ok);
  console.log(`\n--- Check summary: ${checks.length - failures.length}/${checks.length} passed ---`);
  if (failures.length) {
    console.log("\nFAILED:");
    for (const f of failures) console.log(`  ✗ ${f.name}${f.detail ? " — " + f.detail : ""}`);
    if (STRICT) process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
