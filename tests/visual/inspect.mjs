/**
 * One-off inspector for the unified tree DOM on prod. Used to debug visual-qa
 * selector mismatches.
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL ?? "https://betterosf.vercel.app";
const GUID = process.argv[2] ?? "3kmr9";

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();

await page.goto(`${BASE}/${GUID}/files`, { waitUntil: "domcontentloaded" });
await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
await page.waitForTimeout(3500);

const treeItems = await page.locator('[role="treeitem"]').all();
console.log(`\nFound ${treeItems.length} treeitem rows on ${BASE}/${GUID}/files:\n`);
for (let i = 0; i < treeItems.length; i++) {
  const text = (await treeItems[i].textContent()) ?? "";
  const ariaExpanded = await treeItems[i].getAttribute("aria-expanded");
  const link = await treeItems[i].locator("a").first();
  const href = (await link.count()) ? await link.getAttribute("href") : "(no anchor)";
  const target = (await link.count()) ? await link.getAttribute("target") : "";
  console.log(`  [${i}] aria-expanded=${ariaExpanded} | href=${href} | target=${target}`);
  console.log(`       text="${text.slice(0, 80)}"`);
}

await browser.close();
