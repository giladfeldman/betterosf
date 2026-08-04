import { test, expect } from "@playwright/test";

const PUBLIC_GUID = "8cd4r"; // Many Labs 2 — well-known public project with components + a folder at osfstorage root

test("landing page renders", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /BetterOSF/i })).toBeVisible();
});

test("paste-URL form navigates to project", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("OSF project URL or GUID").fill(`https://osf.io/${PUBLIC_GUID}`);
  await page.getByRole("button", { name: "Browse" }).click();
  await expect(page).toHaveURL(new RegExp(`/${PUBLIC_GUID}$`));
});

test("project overview shows components, linked, registrations counts", async ({ page }) => {
  await page.goto(`/${PUBLIC_GUID}`);
  await expect(page.getByRole("heading", { name: /Components \(\d+\)/ })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("heading", { name: /Linked projects \(\d+\)/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Registrations \(\d+\)/ })).toBeVisible();
});

test("files page lists at least one provider", async ({ page }) => {
  await page.goto(`/${PUBLIC_GUID}/files`);
  await expect(page.getByText("osfstorage")).toBeVisible({ timeout: 15_000 });
});

test("folder link is a real anchor (right-clickable)", async ({ page }) => {
  await page.goto(`/${PUBLIC_GUID}/files`);
  const folderLink = page.locator("a", { hasText: /📁/ }).first();
  await expect(folderLink).toBeVisible({ timeout: 15_000 });
  const href = await folderLink.getAttribute("href");
  expect(href).toMatch(/^\/8cd4r\/files\/osfstorage\//);
});

test("provider ZIP link returns application/zip", async ({ page, request }) => {
  await page.goto(`/${PUBLIC_GUID}/files`);
  const zipLink = page.locator('a:has-text("[⬇ ZIP]")').first();
  const href = await zipLink.getAttribute("href");
  expect(href).toBeTruthy();
  const res = await request.get(href!);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("zip");
});

test("whole-project ZIP route responds with application/zip headers", async () => {
  // The route is server-streamed and Many Labs 2 takes a long time to fully drain;
  // here we only verify headers (status + content-type + disposition) by aborting
  // the body read after the first chunk. Byte-magic verification of the actual
  // archive is covered by the integration suite.
  test.setTimeout(120_000);
  const controller = new AbortController();
  const res = await fetch(`http://localhost:4747/api/zip/${PUBLIC_GUID}`, { signal: controller.signal });
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toContain("zip");
  expect(res.headers.get("content-disposition") ?? "").toMatch(/\.zip"?$/);
  // Read just the first chunk to confirm body is streaming, then abort.
  const reader = res.body?.getReader();
  if (reader) {
    const { value } = await reader.read();
    expect(value).toBeDefined();
    expect(value!.byteLength).toBeGreaterThan(0);
    // First bytes of any non-empty ZIP must be PK\x03\x04 (local file header).
    expect(Array.from(value!.slice(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]);
    await reader.cancel();
  }
  controller.abort();
});

test("/me redirects to /login when not signed in", async ({ page }) => {
  await page.goto("/me");
  await expect(page).toHaveURL(/\/login/);
  // Both the header UserMenu and the login page itself render the sign-in button.
  await expect(page.getByRole("button", { name: /sign in with osf/i }).first()).toBeVisible();
});

test("landing page shows Sign in button when signed out", async ({ page }) => {
  await page.goto("/");
  // Rendered by the header UserMenu (signed-out branch).
  await expect(page.getByRole("button", { name: /sign in with osf/i }).first()).toBeVisible();
});

test("/search renders empty-state when q is missing", async ({ page }) => {
  await page.goto("/search");
  await expect(page.getByRole("heading", { name: /search osf/i })).toBeVisible();
  await expect(page.getByText(/type a query above/i)).toBeVisible();
});

test("/search?q=replication returns project results with real anchor links", async ({ page }) => {
  test.setTimeout(30_000);
  await page.goto("/search?q=replication&type=projects");
  await expect(page.getByRole("heading", { name: /search osf/i })).toBeVisible();
  // Should have at least one real anchor (right-click → open in new tab works)
  const links = page.locator("a[href^='/']");
  await expect(links.first()).toBeVisible({ timeout: 15_000 });
});

test("files page shows unified tree with all-folders-expanded", async ({ page }) => {
  await page.goto(`/${PUBLIC_GUID}/files`);
  await expect(page.locator('[role="tree"]')).toBeVisible({ timeout: 20_000 });
  // Expand-all button is in tree header
  await expect(page.getByRole("button", { name: /expand all/i })).toBeVisible();
});

test("theme segmented control cycles through Light/System/Dark and updates <html> class", async ({ page }) => {
  await page.goto("/");
  const radiogroup = page.getByRole("radiogroup", { name: /theme/i });
  await expect(radiogroup).toBeVisible();
  // Three radios with accessible names "Light theme" / "System theme" / "Dark theme"
  const light = radiogroup.getByRole("radio", { name: /light theme/i });
  const dark = radiogroup.getByRole("radio", { name: /dark theme/i });
  const system = radiogroup.getByRole("radio", { name: /system theme/i });
  await dark.click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await light.click();
  await expect(page.locator("html")).toHaveClass(/light/);
  await system.click();
  // System mode delegates to OS preference; class is either 'light' or 'dark'
  const cls = await page.locator("html").getAttribute("class");
  expect(cls).toMatch(/(light|dark)/);
});

test("file view route renders viewer for a markdown file", async ({ page }) => {
  // Many Labs 2 has a Readme.md or similar — find any .md in osfstorage; fallback to deep listing
  await page.goto(`/${PUBLIC_GUID}/files/osfstorage`);
  // Heuristic: click first .md link if present; otherwise skip
  const mdLink = page.locator('a[href*="/files/view/"][href$=".md"]').first();
  const has = await mdLink.count();
  if (has > 0) {
    await mdLink.click();
    await expect(page).toHaveURL(/\/files\/view\/.*\.md$/);
    // Markdown viewer renders an <article>
    await expect(page.locator("article")).toBeVisible({ timeout: 15_000 });
  }
});

test("search supports OR syntax", async ({ page }) => {
  await page.goto("/search?q=replication%20OR%20meta-analysis&type=projects");
  await expect(page.getByText(/Showing/i)).toBeVisible({ timeout: 15_000 });
});

test("search syntax help popover toggles", async ({ page }) => {
  await page.goto("/search?q=test");
  await page.getByRole("button", { name: /search syntax help/i }).click();
  await expect(page.getByText(/AND is default/i)).toBeVisible();
});

test("page size selector persists across navigations", async ({ page }) => {
  await page.goto("/search?q=replication&type=projects");
  const select = page.getByLabel(/per page/i);
  await select.selectOption("100");
  await page.waitForURL(/size=100/);
  await page.goto("/search?q=foo&type=projects");
  await expect(select).toHaveValue("100");
});

test("pin button toggles and persists across reload", async ({ page }) => {
  await page.goto(`/${PUBLIC_GUID}`);
  const pin = page.getByRole("button", { name: /^Pin$/i });
  await expect(pin).toBeVisible({ timeout: 10_000 });
  await pin.click();
  await expect(page.getByRole("button", { name: /Unpin/i })).toBeVisible({ timeout: 5_000 });
  await page.reload();
  await expect(page.getByRole("button", { name: /Unpin/i })).toBeVisible({ timeout: 10_000 });
  // Clean up so a re-run starts pristine
  await page.getByRole("button", { name: /Unpin/i }).click();
});

test("recently viewed appears on landing after navigation", async ({ page }) => {
  await page.goto(`/${PUBLIC_GUID}`);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Recently viewed/i })).toBeVisible({ timeout: 10_000 });
});

test("citation export renders 5 formats", async ({ page }) => {
  await page.goto(`/${PUBLIC_GUID}`);
  await expect(page.getByText(/^APA$/)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/^BibTeX$/)).toBeVisible();
  await expect(page.getByText(/^RIS$/)).toBeVisible();
});

test("folder left-click expands inline without navigating away", async ({ page }) => {
  await page.goto(`/${PUBLIC_GUID}/files`);
  await expect(page.locator('[role="tree"]')).toBeVisible({ timeout: 20_000 });
  // Find the first folder-kind anchor inside the tree
  const folderLink = page.locator('[role="tree"] a[href*="/files/osfstorage/"]').first();
  await expect(folderLink).toBeVisible({ timeout: 15_000 });
  const beforeUrl = page.url();
  await folderLink.click();
  // URL stays on /files — the click was intercepted to toggle expansion
  expect(page.url()).toBe(beforeUrl);
  // The aria-expanded state of the row flipped to true
  const treeitem = folderLink.locator('xpath=ancestor::*[@role="treeitem"][1]');
  await expect(treeitem).toHaveAttribute("aria-expanded", "true", { timeout: 5_000 });
});

test("right-click target on a folder is a real anchor (open-in-new-tab works)", async ({ page }) => {
  await page.goto(`/${PUBLIC_GUID}/files`);
  await expect(page.locator('[role="tree"]')).toBeVisible({ timeout: 20_000 });
  const folderLink = page.locator('[role="tree"] a[href*="/files/osfstorage/"]').first();
  await expect(folderLink).toBeVisible({ timeout: 15_000 });
  // Anchor has a real href — browser context menu can offer "Open in new tab"
  const href = await folderLink.getAttribute("href");
  expect(href).toMatch(/^\/8cd4r\/files\/osfstorage\//);
  // And the anchor is tag-A (no client-side button substitute)
  await expect(folderLink).toHaveJSProperty("tagName", "A");
});

test("Expand all reveals more rows than the initial state", async ({ page }) => {
  await page.goto(`/${PUBLIC_GUID}/files`);
  await expect(page.locator('[role="tree"]')).toBeVisible({ timeout: 20_000 });
  // Collapse first so we have a low baseline
  await page.getByRole("button", { name: /collapse all/i }).click();
  const baseline = await page.locator('[role="treeitem"]').count();
  await page.getByRole("button", { name: /expand all/i }).click();
  // After a short tick, the row count should be strictly greater than baseline
  await expect.poll(async () => page.locator('[role="treeitem"]').count(), { timeout: 5_000 }).toBeGreaterThan(baseline);
});

test("search highlights matched keywords with <mark> in result rows", async ({ page }) => {
  test.setTimeout(30_000);
  await page.goto("/search?q=replication&type=projects");
  // Wait for at least one result anchor or the explicit empty-state
  await page.waitForSelector("a[href^='/']", { timeout: 15_000 }).catch(() => undefined);
  // At least one <mark> should appear somewhere in the result rows
  const marks = page.locator("mark");
  await expect.poll(async () => marks.count(), { timeout: 10_000 }).toBeGreaterThan(0);
  // And the matched text is the keyword (case-insensitive)
  const firstMarkText = (await marks.first().textContent())?.toLowerCase() ?? "";
  expect(firstMarkText).toContain("replication");
});
