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
