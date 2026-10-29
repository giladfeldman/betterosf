/**
 * Signed-in smoke probe — LOCAL ONLY (d-e9cb48, d-4fc564).
 *
 * Every other automated probe is anonymous, and an anonymous request can never produce a
 * 401: that is how the v1.7.0 expired-token bug reached production. This probe signs in as
 * the THROWAWAY OSF account and walks the pages only a signed-in user sees.
 *
 *   npm run build && npm start            # local production server on 4747
 *   npm run test:signed-in                # = node --env-file=.env.local tests/signed-in/signed-in-probe.mjs
 *
 * How it signs in without a password and without adding anything to the app:
 * Auth.js keeps the session in an encrypted JWT cookie. The probe encrypts one itself with
 * `AUTH_SECRET` from `.env.local` (exactly what Auth.js does after an OAuth sign-in), with
 * `OSF_TEST_TOKEN` as the OSF access token, and hands it to the browser. No test-only route,
 * flag or code path exists in the app, so there is nothing that could be switched on in a
 * production build. Nobody types a password into osf.io.
 *
 * Interlocks (each refuses to run rather than guess):
 *   1. BASE must be localhost:4747, and its <title> must be BetterOSF's.
 *   2. OSF_TEST_TOKEN must belong to the throwaway user (`wf83z`, or OSF_TEST_USER_ID) —
 *      checked against OSF's own /users/me/ BEFORE any write. The owner's real account is
 *      never touched.
 *   3. Every write happens inside a private project this run creates, titled "delete me",
 *      and that project is deleted in `finally`, then confirmed gone.
 *
 * Covers: deep project pages signed in (with an anonymous control that must NOT see the
 * private project), the 401 path (an invalid token must read "connection expired", never a
 * 500), the citation route's 401, and /tools/licence-check end to end — list, tick, bulk set,
 * and OSF's own read-back of the licence.
 *
 * Not in `npm test`, CI or /ship's production pass: it writes to OSF (a throwaway account).
 * OSF stops accepting NEW projects on 2026-11-16; after that, point OSF_PROBE_GUID at an
 * existing private test project on the throwaway account (it is then NOT deleted).
 */
import { chromium } from "playwright";
import { encode } from "next-auth/jwt";

const BASE = "http://localhost:4747";
const API = "https://api.osf.io/v2";
const WB = "https://files.osf.io/v1";
const EXPECTED_USER = process.env.OSF_TEST_USER_ID?.trim() || "wf83z";
const TOKEN = process.env.OSF_TEST_TOKEN?.trim();
const SECRET = process.env.AUTH_SECRET?.trim();
const COOKIE = "authjs.session-token"; // http://localhost → no __Secure- prefix
const FILE_NAME = "betterosf-probe.txt";
const FILE_TEXT = "BetterOSF signed-in probe file. Safe to delete.";

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok });
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}
function die(msg) {
  console.error(`REFUSED: ${msg}`);
  process.exit(2);
}

async function osf(path, init = {}) {
  const res = await fetch(path.startsWith("http") ? path : `${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${TOKEN}`, Accept: "application/vnd.api+json", ...(init.headers ?? {}) },
  });
  return res;
}

async function sessionCookie(accessToken, { expiresInMs = 50 * 60_000 } = {}) {
  const value = await encode({
    salt: COOKIE,
    secret: SECRET,
    token: {
      sub: EXPECTED_USER,
      name: "BetterOSF probe",
      accessToken,
      accessTokenExpires: Date.now() + expiresInMs,
      osfScope: "osf.full_read osf.full_write",
      osfUserId: EXPECTED_USER,
    },
  });
  return { name: COOKIE, value, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" };
}

async function main() {
  // ---------------------------------------------------------------- interlocks
  if (!TOKEN) die("OSF_TEST_TOKEN is not set (run with --env-file=.env.local).");
  if (!SECRET) die("AUTH_SECRET is not set.");
  const home = await fetch(BASE, { headers: { "User-Agent": "Mozilla/5.0 probe" } }).catch(() => null);
  const title = home ? (await home.text()).match(/<title>([^<]*)<\/title>/)?.[1] ?? "" : "";
  if (!/BetterOSF/.test(title)) die(`${BASE} is not BetterOSF (title: "${title}"). Start it with npm start.`);
  const me = await osf("/users/me/");
  const meId = me.ok ? (await me.json()).data?.id : null;
  if (meId !== EXPECTED_USER) die(`OSF_TEST_TOKEN belongs to "${meId ?? "unknown"}", not the throwaway "${EXPECTED_USER}".`);
  check("token belongs to the throwaway account", true, EXPECTED_USER);

  // ---------------------------------------------------------------- temp project
  const reuse = process.env.OSF_PROBE_GUID?.trim();
  const projectTitle = `BetterOSF signed-in probe - delete me ${new Date().toISOString().slice(0, 16)}`;
  let guid = reuse ?? null;
  let titleShown = projectTitle;
  const browser = await chromium.launch();
  try {
    if (!guid) {
      const created = await osf("/nodes/", {
        method: "POST",
        headers: { "Content-Type": "application/vnd.api+json" },
        body: JSON.stringify({ data: { type: "nodes", attributes: { title: projectTitle, category: "project", public: false } } }),
      });
      if (created.status !== 201) die(`could not create the temp project (HTTP ${created.status}).`);
      guid = (await created.json()).data.id;
      check("created temporary private project", true, guid);
    } else {
      titleShown = (await (await osf(`/nodes/${guid}/`)).json()).data.attributes.title;
    }
    const up = await osf(`${WB}/resources/${guid}/providers/osfstorage/?kind=file&name=${FILE_NAME}`, {
      method: "PUT",
      body: FILE_TEXT,
    });
    check("uploaded a probe file to it", up.status === 201 || up.status === 200 || up.status === 409, `HTTP ${up.status}`);

    // ---------------------------------------------------------------- signed-in deep pages
    const signedIn = await browser.newContext();
    await signedIn.addCookies([await sessionCookie(TOKEN)]);
    const page = await signedIn.newPage();
    const visit = async (path) => {
      const res = await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
      await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
      return { status: res?.status() ?? 0, text: await page.locator("body").innerText() };
    };

    let r = await visit(`/${guid}`);
    check("signed in: project overview shows the PRIVATE project", r.status === 200 && r.text.includes(titleShown), `HTTP ${r.status}`);
    r = await visit(`/${guid}/files`);
    check("signed in: file tree lists the probe file", r.status === 200 && r.text.includes(FILE_NAME), `HTTP ${r.status}`);
    r = await visit(`/${guid}/files/view/osfstorage/${FILE_NAME}`);
    check("signed in: deep file view renders the file", r.status === 200 && r.text.includes("signed-in probe file"), `HTTP ${r.status}`);
    const cite = await page.request.get(`${BASE}/api/osf/citation/${guid}`);
    check(
      "signed in: citation response is private, never public",
      cite.status() === 200 && /private/.test(cite.headers()["cache-control"] ?? "") && !/public/.test(cite.headers()["cache-control"] ?? ""),
      `HTTP ${cite.status()} ${cite.headers()["cache-control"]}`,
    );

    // Two-sided control: the same private page anonymously must NOT show the project.
    const anon = await browser.newContext();
    const anonPage = await anon.newPage();
    const anonRes = await anonPage.goto(`${BASE}/${guid}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    const anonText = await anonPage.locator("body").innerText();
    check("control: anonymous visitor does NOT see the private project", !anonText.includes(titleShown), `HTTP ${anonRes?.status()}`);
    await anon.close();

    // ---------------------------------------------------------------- the 401 path
    const expired = await browser.newContext();
    await expired.addCookies([await sessionCookie("probe-invalid-token-not-a-real-osf-token")]);
    const ePage = await expired.newPage();
    const eRes = await ePage.goto(`${BASE}/${guid}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    const eText = await ePage.locator("body").innerText();
    check(
      "401 path: a rejected token reads 'connection expired', not a server error",
      (eRes?.status() ?? 500) < 500 && /connection expired/i.test(eText),
      `HTTP ${eRes?.status()}`,
    );
    const listing = `${API}/nodes/${guid}/files/osfstorage/`;
    const f = await ePage.request.get(`${BASE}/api/files/${guid}/folder?listingUrl=${encodeURIComponent(listing)}`);
    const fBody = await f.json().catch(() => ({}));
    check("401 path: folder API answers 401 osf_unauthorized", f.status() === 401 && fBody.code === "osf_unauthorized", `HTTP ${f.status()}`);
    const c = await ePage.request.get(`${BASE}/api/osf/citation/${guid}`);
    check("401 path: citation API answers 401, not 200-with-empty", c.status() === 401, `HTTP ${c.status()}`);
    await expired.close();

    // ---------------------------------------------------------------- licence check
    await page.goto(`${BASE}/tools/licence-check`, { waitUntil: "domcontentloaded" });
    const summary = page.getByTestId("licence-summary");
    await summary.waitFor({ timeout: 120_000 });
    check("licence-check: list loaded", true, (await summary.innerText()).slice(0, 90));
    const box = page.getByRole("checkbox", { name: `Select ${titleShown}` });
    const tickable = (await box.count()) === 1;
    check("licence-check: the unlicensed temp project is listed and tickable", tickable);
    if (tickable) {
      await box.check();
      await page.getByPlaceholder("e.g. Jane Doe; John Roe").fill("BetterOSF Probe");
      await page.getByPlaceholder("e.g. 2024").fill("2026");
      const licenceName = await page.locator("select").first().evaluate((s) => s.options[s.selectedIndex].text);
      await page.getByRole("button", { name: /Set licence on 1 selected/ }).click();
      await page.getByRole("button", { name: "Yes, set the licence" }).click();
      await page.getByText(/could not be confirmed|Stopped setting licences/).first().waitFor({ timeout: 30_000 }).catch(() => {});
      await page.waitForFunction(() => !document.body.innerText.includes("Setting licences on OSF"), null, { timeout: 120_000 });
      const ui = await page.locator("body").innerText();
      check("licence-check: no failure shown after bulk set", !/could not be confirmed|Stopped setting licences/.test(ui));
      const node = await (await osf(`/nodes/${guid}/?embed=license`)).json();
      const onOsf = node.data?.embeds?.license?.data?.attributes?.name ?? null;
      check("licence-check: OSF's own read-back holds the licence", onOsf === licenceName, `OSF says "${onOsf}", picked "${licenceName}"`);
    }
    await signedIn.close();
  } finally {
    await browser.close();
    if (guid && !reuse) {
      const del = await osf(`/nodes/${guid}/`, { method: "DELETE" });
      const gone = await osf(`/nodes/${guid}/`);
      check("cleanup: temporary project deleted", del.status === 204 && (gone.status === 410 || gone.status === 404), `DELETE ${del.status}, then GET ${gone.status}`);
    }
  }

  const failed = results.filter((x) => !x.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
