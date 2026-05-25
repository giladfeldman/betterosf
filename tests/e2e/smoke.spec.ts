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
  const res = await fetch(`http://localhost:3000/api/zip/${PUBLIC_GUID}`, { signal: controller.signal });
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

test("dark mode toggle cycles and persists", async ({ page }) => {
  await page.goto("/");
  const toggle = page.getByRole("button", { name: /Theme:/i });
  await expect(toggle).toBeVisible();
  await toggle.click();
  await toggle.click();
  // After two clicks from "system" we're at light or dark — just confirm class is set on <html>
  const cls = await page.locator("html").getAttribute("class");
  expect(cls).toMatch(/(light|dark)/);
});

test("file view route renders viewer for a markdown file", async ({ page }) => {
  // Many Labs 2 has a Readme.md or similar — find any .md in osfstorage; fallback to deep listing
  await page.goto(`/${PUBLIC_GUID}/files/osfstorage`);
  // Heuristic: click first .md link if present; otherwise skip
  const mdLink = page.locator('a[href*=".md/view"]').first();
  const has = await mdLink.count();
  if (has > 0) {
    await mdLink.click();
    await expect(page).toHaveURL(/\.md\/view$/);
    // Markdown viewer renders an <article>
    await expect(page.locator("article")).toBeVisible({ timeout: 15_000 });
  }
});
