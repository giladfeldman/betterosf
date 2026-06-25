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

// Be respectful of OSF's anonymous rate limits IN ADVANCE, not after a 429:
// pace page navigations (each one fans out to several OSF API calls server-side)
// and back off when throttled. Keeps a single run from bursting OSF. Tunable via
// VQA_THROTTLE_MS (default 700ms between OSF-hitting navigations).
const THROTTLE_MS = Number(process.env.VQA_THROTTLE_MS ?? 700);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Sleep after a navigation; if OSF (or our middleware) returned 429, honour Retry-After. */
async function pace(resp) {
  let ms = THROTTLE_MS;
  if (resp && resp.status && resp.status() === 429) {
    const ra = Number(resp.headers()["retry-after"]);
    ms = Math.max(ms, (Number.isFinite(ra) ? ra : 60) * 1000);
    console.log(`  …throttled (429), backing off ${Math.round(ms / 1000)}s`);
  }
  await sleep(ms);
}

// Well-known fixtures we lean on for click-through tests. If OSF removes any
// of these the script needs an update — but using stable canonical projects
// keeps the script useful without per-run hand-tuning.
const HEAVY_GUID = "3kmr9";          // PCIRR project with folders that contain SPACES — regression fixture
const MANY_LABS_GUID = "8cd4r";      // Many Labs 2 — components + registrations + folders + sizable
const REG_PARENT_GUID = "3kmr9";     // 3kmr9 has registration ujyh9 — used for registration-expand test
const PPTX_GUID = "qyzha";           // Public project with a small OSF Storage PPTX fixture

// One representative REAL guid per OSF object type. The flat /<guid> route must
// resolve ALL of these — the regression that shipped P9QB4 ("Project not found"
// for a registration) is exactly what this guards. If OSF removes any fixture,
// swap in another public one of the same type.
const GUID_TYPES = [
  { name: "G1-node", guid: MANY_LABS_GUID, kind: "node" },
  { name: "G2-registration", guid: "P9QB4", kind: "registration" },   // the reported bug
  { name: "G3-preprint", guid: "g7w6u", kind: "preprint" },
  { name: "G4-user", guid: "m4kfe", kind: "user" },
  { name: "G5-file-redirect", guid: "iuky6", kind: "file" },          // → /8cd4r/files/view/osfstorage/ML2_-_Protocol.pdf
];

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
  { name: "16b-bookmarklet", url: "/bookmarklet" },
  { name: "17-privacy", url: "/privacy" },
  { name: "18-404", url: "/notarealroute/files" },
  ...GUID_TYPES.map((g) => ({ name: `19-guidtype-${g.kind}`, url: `/${g.guid}` })),
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
      if (msg.type() !== "error") return;
      const text = msg.text();
      // Filter out browser-emitted "Failed to load resource: status of 4xx/5xx"
      // for resources we don't care about (favicon, dev-tools probes), AND for
      // the 404 page itself where the browser logs an error for the 404 HTTP
      // response of the main document — that's framework behavior, not a bug.
      if (/Failed to load resource: the server responded with a status of 404/.test(text)) return;
      consoleErrors.push(text.slice(0, 200));
    });
    try {
      const resp = await page.goto(full, { waitUntil: "domcontentloaded", timeout: 30_000 });
      status = String(resp?.status() ?? "no-resp");
      await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
      await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
      // Pace OSF-hitting navigations (back off harder on 429) so a single run
      // stays under OSF's anonymous rate limit instead of discovering it post-hoc.
      await pace(resp);
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

  // --- About/Info unification + bookmarklet + tree action group ---
  console.log("\n--- About/Info unification + bookmarklet + tree action group ---");

  // /information unifies into /about (server redirect).
  await page.goto(`${BASE}/information`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
  record("/information redirects to /about", new URL(page.url()).pathname === "/about", page.url());

  // /bookmarklet shows the draggable link.
  await page.goto(`${BASE}/bookmarklet`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
  const draggable = page.getByText(/OSF\s*⇄\s*BetterOSF/i).first();
  record("/bookmarklet shows draggable link", (await draggable.count()) > 0);

  // Tree row shows Upload + ZIP + New folder WITHOUT hover (glitch regression).
  await page.goto(`${BASE}/${MANY_LABS_GUID}/files`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
  const uploadBtn = page.getByRole("button", { name: /^Upload to /i }).first();
  const zipLink = page.getByRole("link", { name: /as ZIP$/i }).first();
  const folderBtn = page.getByRole("button", { name: /^New folder in /i }).first();
  const actionsVisible =
    (await uploadBtn.count()) > 0 && (await uploadBtn.isVisible()) &&
    (await zipLink.count()) > 0 && (await zipLink.isVisible()) &&
    (await folderBtn.count()) > 0 && (await folderBtn.isVisible());
  record("tree row shows Upload + ZIP + New folder without hover", actionsVisible);

  // Tree toolbar offers the Directory view (folders-only, the default) alongside
  // Expand all / Collapse all.
  const directoryBtn = page.getByRole("button", { name: /^Directory$/ }).first();
  record("tree toolbar has a Directory (folders-only) control", (await directoryBtn.count()) > 0 && (await directoryBtn.isVisible()));

  // Clicking "+ Folder" expands an inline input that must NOT overlap adjacent
  // virtualized rows (regression: fixed 28px rows + overflow:visible let the
  // expanded control bleed over the row below). With virtualizer.measureElement
  // the row grows, so the next row's top must sit at/after the expanded bottom.
  if ((await folderBtn.count()) > 0) {
    await folderBtn.click();
    await page.waitForTimeout(350); // let ResizeObserver remeasure + rows reflow
    const inputVisible = await page.getByRole("textbox", { name: /new folder name/i }).first().isVisible().catch(() => false);
    const overlapPx = await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll('[role="treeitem"]'));
      const idx = items.findIndex((it) => it.querySelector('input[aria-label="New folder name"]'));
      if (idx < 0 || idx + 1 >= items.length) return null;
      const a = items[idx].getBoundingClientRect();
      const b = items[idx + 1].getBoundingClientRect();
      return a.bottom - b.top; // <= ~1px means the rows don't overlap
    });
    record(
      "new-folder inline expand does not overlap the next tree row",
      inputVisible && overlapPx !== null && overlapPx <= 1,
      `inputVisible=${inputVisible} overlapPx=${overlapPx}`
    );
  } else {
    record("new-folder trigger present for overlap test", false, "no + Folder button found");
  }

  // Guid URL canonicalisation: BetterOSF must serve brief, lowercase guid URLs
  // (matching OSF's canonical form). Uppercase guid -> lowercase; /overview
  // suffix (an OSF redirect) -> brief. These are 308 redirects in middleware,
  // so the final URL is what matters (independent of OSF render latency).
  await page.goto(`${BASE}/${HEAVY_GUID.toUpperCase()}`, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => {});
  record(
    "uppercase guid canonicalises to lowercase brief URL",
    new URL(page.url()).pathname === `/${HEAVY_GUID}`,
    page.url()
  );
  await page.goto(`${BASE}/${HEAVY_GUID}/overview`, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => {});
  record(
    "/<guid>/overview canonicalises to brief /<guid>",
    new URL(page.url()).pathname === `/${HEAVY_GUID}`,
    page.url()
  );
  // A file addressed by its own guid (`/<guid>/files/<fileGuid>`) — not a
  // storage provider — must rewrite to the bare `/<fileGuid>` route (308),
  // rather than hitting "Storage provider not found". Uses a synthetic guid so
  // the assertion checks the redirect path only (independent of OSF).
  await page.goto(`${BASE}/${HEAVY_GUID}/files/zzzz9`, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => {});
  record(
    "/<guid>/files/<fileGuid> canonicalises to bare /<fileGuid>",
    new URL(page.url()).pathname === "/zzzz9",
    page.url()
  );

  // Helper: detect the "Project not found" route-level error VISIBLY, not via
  // bodyText.includes — Next.js embeds the dormant /<guid>/not-found.tsx
  // template inside the streaming RSC payload so a raw text search hits it
  // even on a fully-working page.
  async function visibleProjectNotFound() {
    const heading = page.getByRole("heading", { name: /^Project not found$/i });
    return (await heading.count()) > 0 && (await heading.first().isVisible());
  }

  // Wait for file-leaf anchors to appear in the tree, polling up to `timeout`
  // instead of a fixed sleep. After "Expand all" lifts the depth ceiling, a
  // fresh OSF fetch cascade runs for the newly-revealed deep levels; a fixed
  // 1.5s wait raced that cascade on multi-level registrations. Waiting on the
  // actual condition is both correct for the depth-stepper and more robust to
  // OSF latency generally. Returns the leaf count (0 if none within timeout).
  async function waitForFileLeaves(timeout = 12_000) {
    const leaves = page.locator('[role="tree"] a[href*="/files/view/"]');
    await leaves.first().waitFor({ state: "attached", timeout }).catch(() => {});
    return leaves.count();
  }

  // Helper: detect any FileMissing render (sub-page error rendered inline by
  // the new FileMissing component when the walk fails). Covers the four
  // reasons: "Storage provider not found" | "Folder not found" |
  // "File not found" | "OSF didn't return this file". This was the gap that
  // let the URL-decoding bug through: visibleProjectNotFound() only caught
  // the route-level error, missing the inline ones.
  async function visibleFileMissing() {
    const heading = page.getByRole("heading", { name: /^(Storage provider not found|Folder not found|File not found|OSF didn't return this file)$/i });
    return (await heading.count()) > 0 && (await heading.first().isVisible());
  }

  // --- 2.5) GUID type coverage: /<guid> must resolve EVERY OSF object type ---
  // OSF uses one flat guid namespace; the flat route must dispatch nodes,
  // registrations, preprints, users, and files. This is the gate that the
  // "Project not found" P9QB4 regression would have tripped.
  console.log("\n--- GUID type coverage (/<guid> dispatches all OSF types) ---");
  for (const g of GUID_TYPES) {
    try {
      const resp = await page.goto(`${BASE}/${g.guid}`, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
      const status = String(resp?.status() ?? "no-resp");
      const notFound = await visibleProjectNotFound();
      const fileMissing = await visibleFileMissing();
      const finalUrl = page.url();
      // A file guid must REDIRECT into the file viewer; the rest stay at /<guid>.
      const redirectedOk = g.kind !== "file" || /\/files\/view\//.test(finalUrl);
      const ok = status === "200" && !notFound && !fileMissing && redirectedOk;
      record(
        `${g.name}: /${g.guid} resolves (${g.kind})`,
        ok,
        ok ? finalUrl.replace(BASE, "") : `status=${status} notFound=${notFound} fileMissing=${fileMissing} url=${finalUrl.replace(BASE, "")}`,
      );
      await page.screenshot({ path: `${OUT}/${g.name}.png`, fullPage: true });
    } catch (e) {
      record(`${g.name}: /${g.guid} resolves (${g.kind})`, false, e instanceof Error ? e.message.slice(0, 120) : String(e));
    }
  }

  // --- 2.6) Registrations are first-class: the overview shows the file/folder
  //     tree navigator (like project pages), and /<reg>/files resolves
  //     (regression: it used to show "Project not found"). ---
  console.log("\n--- Registration files + tree navigator ---");
  {
    const REG = "P9QB4";
    await page.goto(`${BASE}/${REG}`, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
    const overviewTrees = await page.locator('[role="tree"]').count();
    record("registration overview shows file tree navigator", overviewTrees > 0, `trees=${overviewTrees}`);

    // Registrations are immutable — no upload affordance anywhere on the page.
    const uploadButtons = await page.getByRole("button", { name: /upload/i }).count();
    record("registration shows NO upload buttons (immutable)", uploadButtons === 0, `uploadButtons=${uploadButtons}`);

    // Progressive auto-load: deep folders/files appear WITHOUT clicking through
    // each level (the reported annoyance). The default "Directory" view hides
    // file leaves, so switch to "Expand all" (a single toolbar click) to reveal
    // the already-auto-loaded files. Allow the cascade a moment.
    await page.waitForTimeout(5000);
    const regExpandAll = page.getByRole("button", { name: /^Expand all$/ }).first();
    let leafCount = 0;
    if (await regExpandAll.count()) {
      await regExpandAll.click();
      // "Expand all" lifts the depth ceiling to "All"; poll for the deep file
      // leaves the freshly-started cascade fetches (not a fixed sleep).
      leafCount = await waitForFileLeaves();
    } else {
      leafCount = await page.locator('[role="tree"] a[href*="/files/view/"]').count();
    }
    record("registration tree auto-loads files (file leaves visible after Expand all)", leafCount > 0, `fileLeaves=${leafCount}`);

    const fresp = await page.goto(`${BASE}/${REG}/files`, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => null);
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
    const fstatus = String(fresp?.status() ?? "no-resp");
    const fNotFound = await visibleProjectNotFound();
    record("registration /<guid>/files resolves (not 'Project not found')", fstatus === "200" && !fNotFound, `status=${fstatus} notFound=${fNotFound}`);
    const filesTrees = await page.locator('[role="tree"]').count();
    record("registration files page shows tree navigator", filesTrees > 0, `trees=${filesTrees}`);
    await page.screenshot({ path: `${OUT}/G2b-registration-files.png`, fullPage: true });
  }

  // --- Regression: a registration with a BROKEN secondary provider (c97pd has an
  //     osfstorage provider with real PDFs AND a github addon whose listing 404s).
  //     Before the per-provider fail-soft fix, the github 404 aborted the whole
  //     skeleton walk and collectResourceTree blanked EVERY file — the user saw an
  //     empty tree on both /<reg> and /<reg>/files. Guard that osfstorage survives. ---
  console.log("\n--- Registration with a broken secondary provider (c97pd) ---");
  {
    const REG = "c97pd";
    const fresp = await page.goto(`${BASE}/${REG}/files`, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => null);
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
    const fstatus = String(fresp?.status() ?? "no-resp");
    record("c97pd /files resolves (not 'Project not found')", fstatus === "200" && !(await visibleProjectNotFound()), `status=${fstatus}`);
    // The osfstorage PDFs (ML2_-_Protocol.pdf, ML2_-_The_Effects.pdf) must auto-load
    // despite the sibling github provider 404ing. Reveal files via "Expand all"
    // (the default Directory view hides file leaves).
    await page.waitForTimeout(5000);
    const c97ExpandAll = page.getByRole("button", { name: /^Expand all$/ }).first();
    let leafCount = 0;
    if (await c97ExpandAll.count()) {
      await c97ExpandAll.click();
      // Poll for the deep file leaves after the ceiling lifts (see helper).
      leafCount = await waitForFileLeaves();
    } else {
      leafCount = await page.locator('[role="tree"] a[href*="/files/view/"]').count();
    }
    record("c97pd tree shows osfstorage files despite a broken sibling provider", leafCount > 0, `fileLeaves=${leafCount}`);
    await page.screenshot({ path: `${OUT}/G2c-registration-broken-provider.png`, fullPage: true });
  }

  // --- 3) Click a file in the tree → preview shows in right pane ---
  console.log("\n--- File-click-from-tree → right-pane preview ---");
  await page.goto(`${BASE}/${MANY_LABS_GUID}/files`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
  // Expand all so file leaves appear in the tree
  const expandAll = page.getByRole("button", { name: /expand all/i }).first();
  if (await expandAll.count()) {
    await expandAll.click();
    // Poll for leaves after the ceiling lifts rather than a fixed sleep.
    await waitForFileLeaves();
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
    record("tree file click does NOT land on 'Project not found'", !(await visibleProjectNotFound()));
    record("tree file click does NOT land on FileMissing (Folder/File not found)", !(await visibleFileMissing()));
    await page.screenshot({ path: `${OUT}/INT-06-tree-file-click.png`, fullPage: true });
  } else {
    record("tree has at least one clickable file leaf", false, "no a[href*='/files/view/'] inside [role=tree]");
  }

  // --- 4) File-view URL with SPACES in path resolves (regression: Next.js 15
  //     catch-all segments arrive URL-encoded but OSF returns decoded names —
  //     the walk must decodeURIComponent each segment or every deep URL fails).
  console.log("\n--- File-view URL with spaces in path ---");
  const spacedUrl = `/${HEAVY_GUID}/files/view/osfstorage/PCIRR%20Stage%202/PCIRR%20S2%20submission/PCIRR-S2-Newman-etal-2011-replication-cover-letter.docx`;
  const spacedResp = await page.goto(BASE + spacedUrl, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => null);
  const spacedStatus = spacedResp?.status() ?? 0;
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
  record(`/files/view URL with %20-encoded spaces: HTTP ${spacedStatus}`, spacedStatus === 200);
  record("/files/view URL with spaces does NOT show 'Project not found'", !(await visibleProjectNotFound()));
  record("/files/view URL with spaces does NOT show FileMissing (Folder/File not found)", !(await visibleFileMissing()));
  await page.screenshot({ path: `${OUT}/INT-07-spaced-fileview.png`, fullPage: true });

  // --- 4b) Additional URL-with-spaces probe at different depths (the original
  //     bug only manifested at depth ≥ 2; surface coverage gaps fast).
  console.log("\n--- Additional spaced-URL probes ---");
  const spacedProbes = [
    `/${HEAVY_GUID}/files/view/osfstorage/PCIRR%20Stage%201/Materials/Newman_et_al_2011_RE_Studies_12.pdf`,
    `/${HEAVY_GUID}/files/view/osfstorage/PCIRR%20Stage%201/Snapshot/PCIRR-S1-Newmanetal2011-rep-ext-snapshot-v4-G.docx`,
    `/${HEAVY_GUID}/files/osfstorage/PCIRR%20Stage%201/Materials`,
  ];
  for (const probe of spacedProbes) {
    const resp = await page.goto(BASE + probe, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => null);
    const status = resp?.status() ?? 0;
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
    const fm = await visibleFileMissing();
    const pnf = await visibleProjectNotFound();
    record(`spaced URL ${probe.slice(-60)}: HTTP ${status} no FileMissing no ProjectNotFound`, status === 200 && !fm && !pnf, fm ? "FileMissing visible" : pnf ? "ProjectNotFound visible" : "");
  }

  // --- 4c) PER-VIEWER content load (the gap that let DOCX/PDF/HTML viewers
  //     break on production while the rest of QA stayed green). For each
  //     viewer kind we load a known fixture and assert:
  //       1. No visible error banner (any of "Failed to load X", "NetworkError",
  //          "Setting up fake worker", "fetch resource").
  //       2. At least one viewer-specific success indicator is rendered
  //          (canvas/iframe/img/table/pre, depending on the kind).
  //     Each probe waits up to 12s for the viewer's async load.
  console.log("\n--- Per-viewer content load ---");
  // Visible "viewer error" detector — any of the error texts our viewers emit.
  async function visibleViewerError() {
    const ERRORS = [
      "Failed to load DOCX",
      "Failed to load PDF",
      "Failed to load XLSX",
      "Failed to load CSV",
      "Failed to load JSON",
      "Failed to load notebook",
      "Failed to load markdown",
      "Failed to load code",
      "NetworkError when attempting to fetch resource",
      "Setting up fake worker failed",
      "error loading dynamically imported module",
    ];
    for (const txt of ERRORS) {
      const loc = page.getByText(txt, { exact: false });
      if ((await loc.count()) > 0 && (await loc.first().isVisible())) return txt;
    }
    return null;
  }

  const VIEWER_PROBES = [
    {
      kind: "pdf",
      url: `/${HEAVY_GUID}/files/view/osfstorage/PCIRR%20Stage%201/Materials/Newman_et_al_2011_RE_Studies_12.pdf`,
      // Browser-native <iframe> PDF viewer.
      success: 'iframe[title="PDF viewer"]',
    },
    {
      kind: "docx",
      url: `/${HEAVY_GUID}/files/view/osfstorage/PCIRR%20Stage%201/Materials/Newman_et_al_2011_RE_Studies_12.docx`,
      // docx-preview renders valid files into .docx-render. THIS fixture is a
      // malformed multi-body export (485 <w:body> elements — Qualtrics-style),
      // which docx-preview renders blank; the viewer correctly shows the honest
      // "Couldn't preview — malformed file" fallback instead of a silent gray
      // box (see DocxViewer.renderProducedContent + docx-empty-render.test.ts).
      // PASS = rendered content OR the fallback heading; never a silent blank.
      success: '.docx-render, article, h2:has-text("preview this document")',
    },
    {
      kind: "pptx",
      url: `/${PPTX_GUID}/files/view/osfstorage/Stimuli/Experiment%202/Experiment2_TrainingSlides.pptx`,
      success: "text=/PPTX preview/i",
    },
    {
      kind: "html",
      url: `/${HEAVY_GUID}/files/view/osfstorage/PCIRR%20Stage%201/Simulated%20data%20and%20planned%20analysis%20code/Newman-etal-2011-Effect-sizes-power-analysis-combined-v4-G.html`,
      success: 'iframe[title="HTML preview"]',
      deadlineMs: 30_000,
    },
    {
      kind: "image",
      url: `/${HEAVY_GUID}/files/view/osfstorage/PCIRR%20Stage%201/Simulated%20data%20and%20planned%20analysis%20code/Figures/S1-2-way-mixed-ANOVA-historical.jpg`,
      success: "img",
    },
    {
      kind: "code/qsf",
      url: `/${HEAVY_GUID}/files/view/osfstorage/PCIRR%20Stage%201/Materials/Newman_et_al_2011_RE_Studies_12.qsf`,
      success: "pre, code",
      deadlineMs: 30_000,
    },
  ];
  for (const probe of VIEWER_PROBES) {
    await page.goto(BASE + probe.url, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => {});
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
    // Give the client-side viewer a chance to fetch + render. We poll for
    // either a success-element OR a known error text — whichever lands first.
    let success = false;
    let errText = null;
    const deadline = Date.now() + (probe.deadlineMs ?? 15_000);
    while (Date.now() < deadline) {
      errText = await visibleViewerError();
      if (errText) break;
      const succ = await page.locator(probe.success).first().count();
      if (succ > 0 && (await page.locator(probe.success).first().isVisible())) {
        success = true;
        break;
      }
      await page.waitForTimeout(500);
    }
    const ok = success && !errText;
    record(`viewer:${probe.kind} loads (no error banner, success el present)`, ok, errText ?? (success ? "" : "no success element rendered before 15s deadline"));
    await page.screenshot({ path: `${OUT}/INT-viewer-${probe.kind.replace(/[^a-z0-9]/g, "_")}.png`, fullPage: true });
  }

  // --- 5) Search with file-extension query returns results ---
  console.log("\n--- Search edge cases ---");
  // Use a known fixture from the heavy project instead of relying on global OSF
  // index churn for bare ".qsf" queries.
  await page.goto(`${BASE}/search?q=Studies_12.qsf&scope=project:${HEAVY_GUID}&type=files`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
  const qsfBody = (await page.textContent("body")) ?? "";
  const qsfHasNoResults = qsfBody.toLowerCase().includes("no results");
  const qsfHasFixture = /studies[_\s-]*12\.qsf/i.test(qsfBody);
  record(
    "search known .qsf fixture in project scope returns results",
    !qsfHasNoResults && qsfHasFixture,
    qsfHasNoResults ? "No-results banner shown" : ""
  );
  await page.screenshot({ path: `${OUT}/INT-08-search-qsf.png`, fullPage: true });

  // Search-in-project (the user said this "doesn't quite work")
  await page.goto(`${BASE}/search?q=docx&scope=project:${HEAVY_GUID}&type=files`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
  const sipBody = (await page.textContent("body")) ?? "";
  const sipHasInThisProject = sipBody.includes("match in this project") || sipBody.includes("walked up to");
  record("search-in-project (files) renders project-scoped UI", sipHasInThisProject);
  await page.screenshot({ path: `${OUT}/INT-09-search-in-project-files.png`, fullPage: true });

  await page.goto(`${BASE}/search?q=MP4%20OR%20MP3&type=files&ext=media`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
  const mediaBody = ((await page.textContent("body")) ?? "").toLowerCase();
  const mediaNoResults = mediaBody.includes("no files match") || mediaBody.includes("no results");
  const mediaHasResult = mediaBody.includes(".mp4") || mediaBody.includes(".mp3");
  record(
    "search media filter query renders (results or explicit empty state)",
    mediaHasResult || mediaNoResults
  );
  await page.screenshot({ path: `${OUT}/INT-09b-search-media-filter.png`, fullPage: true });

  // --- 6) Registrations expand in tree ---
  // The tree is VIRTUALIZED — only visible rows are rendered. To find the
  // Registrations group we must first collapse the (large) providers section
  // so Registrations comes into view at the top.
  console.log("\n--- Registrations expandable in tree ---");
  await page.goto(`${BASE}/${REG_PARENT_GUID}/files`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
  await page.waitForTimeout(2000); // hydrate
  // Collapse everything so we see all the top-level group rows without scrolling.
  const collapseAll = page.getByRole("button", { name: /collapse all/i }).first();
  if (await collapseAll.count()) {
    await collapseAll.click();
    await page.waitForTimeout(600);
  }
  const regsRoot = page.locator('[role="treeitem"]', { hasText: /Registrations \(/i }).first();
  if (await regsRoot.count()) {
    // "Collapse all" collapses to provider-root level but keeps the Registrations
    // group (and each registration node) expanded, so the registration rows are
    // already visible. Only toggle the group open if they aren't.
    let regCount = await page.locator('[role="treeitem"] a[href*="/registrations/"]').count();
    if (regCount === 0) {
      // The treeitem div has no click handler — the toggle target is the inner
      // span[role="button"] (registrations-root has no href).
      const regsBtn = regsRoot.locator('[role="button"]').first();
      if (await regsBtn.count()) {
        await regsBtn.click();
      } else {
        await regsRoot.locator('button[aria-label*="Expand" i], button[aria-label*="Collapse" i]').first().click();
      }
      await page.waitForTimeout(1200);
      regCount = await page.locator('[role="treeitem"] a[href*="/registrations/"]').count();
    }
    record(`registrations section expanded — N registration rows visible: ${regCount}`, regCount > 0);

    // Click the first registration row (anchor click; intercepted because
    // kind="registration" → interceptLeftClick is true).
    const firstReg = page.locator('[role="treeitem"] a[href*="/registrations/"]').first();
    if (await firstReg.count()) {
      const beforeUrl = page.url();
      await firstReg.click({ modifiers: [] });
      await page.waitForTimeout(4000); // skeleton fetch can take time
      const navigatedAway = !page.url().includes(`/${REG_PARENT_GUID}/files`);
      if (navigatedAway) {
        record("registration click expands sub-tree (did not navigate away)", false, page.url());
      } else {
        const providerRows = await page.locator('[role="treeitem"]', { hasText: /osfstorage/i }).count();
        record(`registration sub-tree shows provider rows (osfstorage count): ${providerRows}`, providerRows > 0);
      }
    }
    await page.screenshot({ path: `${OUT}/INT-10-registrations-expanded.png`, fullPage: true });
  } else {
    record("registrations group is present in the tree", false, "no treeitem matching /Registrations \\(/");
  }

  // --- 7) Folder click on /files page stays inline ---
  // The previous test left the 3kmr9 tree in a collapsed state via "Collapse
  // all". Click "Expand all" before searching for a folder anchor.
  // We use the literal-space attribute selector — browsers store the href
  // attribute value verbatim from JSX (Playwright getAttribute returns it
  // unencoded), so [href*="PCIRR Stage 1"] matches but [href*="PCIRR%20Stage%201"] does not.
  console.log("\n--- Folder click inline-expand ---");
  await page.goto(`${BASE}/${HEAVY_GUID}/files`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
  await page.waitForTimeout(2500);
  const expandAllFolder = page.getByRole("button", { name: /expand all/i }).first();
  if (await expandAllFolder.count()) {
    await expandAllFolder.click();
    await page.waitForTimeout(2500);
  }
  const folderAnchor = page.locator('[role="tree"] a[href*="/files/osfstorage/PCIRR Stage 1"]').first();
  if (await folderAnchor.count()) {
    const beforeUrl = page.url();
    await folderAnchor.click();
    await page.waitForTimeout(1200);
    const stayed = page.url() === beforeUrl;
    record("folder left-click expands inline (URL unchanged)", stayed, stayed ? "" : `navigated to ${page.url()}`);
  } else {
    record("folder left-click expands inline (URL unchanged)", false, "no PCIRR Stage 1 folder anchor found in tree");
  }

  const selectButton = page.getByRole("button", { name: /^Select$/ }).first();
  if (await selectButton.count()) {
    await selectButton.click();
    await page.waitForTimeout(500);
    const checkboxes = await page.locator('[role="tree"] input[type="checkbox"]').count();
    record(`navigator select mode exposes checkboxes: ${checkboxes}`, checkboxes > 0);
    const zipActions = await page.locator('[role="tree"] a[aria-label*="Download"][href*="/api/zip/"]').count();
    record(`navigator exposes folder ZIP actions: ${zipActions}`, zipActions > 0);
  } else {
    record("navigator select mode button present", false);
  }

  await page.goto(`${BASE}/${MANY_LABS_GUID}/files`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
  await page.waitForTimeout(2500);
  const longFilenameTooltip = await page.locator('[role="tree"] [title*="ML2 Polynomial Tests of Order Effects.txt"]').count();
  record("navigator long filenames expose full title tooltip", longFilenameTooltip > 0);

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
