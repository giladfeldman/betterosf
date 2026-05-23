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
