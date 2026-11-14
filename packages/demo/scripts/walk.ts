// The demo in real browsers: build it, serve it as the website does, and walk it as a visitor would.
//
//   bun run test:browser                     every engine Playwright has a browser for on this machine
//   bun run test:browser chromium firefox    these engines, each of which must be there
//
// Each line it prints is one thing a visitor depends on. It exits 1 when one fails.

import { existsSync, mkdtempDisposableSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { type Browser, type BrowserContext, type BrowserType, chromium, firefox, type Page, webkit } from "playwright";

import { buildDemo } from "./build";
import { serveStatic } from "./static-host";

/** The path the website serves the demo at. */
const AT = "/poplin/demo/";

/** The browsers a walk can run in. */
const ENGINES: Readonly<Record<string, BrowserType>> = { chromium, firefox, webkit };

/** The pages of the dashboard a visitor reaches from its own navigation, as paths under the demo. */
const TABS = ["", "tokens", "settings", "activity", "usage", "domain", "?view=trash"];

/** A link to a site's page in the dashboard. */
const SITE_LINK = 'main a[href*="/sites/"]';

/** A link to a site as it is served. */
const SERVED_LINK = 'main a[href*="/served/"]';

/** The button of the form that moves a site to the trash. */
const TRASH_BUTTON = 'form[action$="/delete"] button[type="submit"]';

/** The name the walk gives the copy of a site. */
const COPY_NAME = "walk-copy";

/** What the product's pages say when a form was refused. */
const REFUSED = "Not done";

/** The declaration a page follows the system's scheme with, until the bar forces one. */
const FOLLOWS_SYSTEM = "color-scheme: light dark";

/** The sentence a stranger reads first. */
const WHAT_IT_IS = "Your agent publishes a folder as a website, in your own account.";

/** How long the first load may take, in milliseconds: the worker installs, SQLite loads, and the seed runs. */
const FIRST_LOAD_MS = 30_000;

/** One walk: its engine, a way to open a browser of it that has never seen the demo, the demo's address, and the lines it adds. */
interface Walk {
  readonly engine: string;
  readonly open: (options?: Parameters<Browser["newContext"]>[0]) => Promise<BrowserContext>;
  readonly origin: string;
  readonly demo: string;
  readonly check: (name: string, ok: boolean, note?: string) => void;
}

async function siteNames(page: Page): Promise<string[]> {
  return page.locator(SITE_LINK).allTextContents();
}

/** Open a site's page in the dashboard and send its trash form. */
async function trash(page: Page, demo: string, name: string): Promise<string> {
  await page.goto(demo);
  await page.click(`${SITE_LINK}:text-is("${name}")`);
  await page.click(TRASH_BUTTON);
  await page.waitForLoadState();

  return page.content();
}

/** The first visit, and that every page after it is the worker's: the dashboard, with the product's own headers. */
async function firstVisit(walk: Walk, page: Page): Promise<void> {
  const { check, demo } = walk;
  await page.goto(`${walk.origin}/`);
  await page.waitForSelector(SITE_LINK, { timeout: FIRST_LOAD_MS });
  const names = await siteNames(page);
  check("the first visit lands on the dashboard with sample sites", page.url() === demo && names.length >= 5, names.join(", "));
  check("the first screen says what the product is", ((await page.locator("#preview-bar").textContent()) ?? "").includes(WHAT_IT_IS));

  const settings = await page.goto(`${demo}settings`);
  const policy = settings?.headers()["content-security-policy"] ?? "";
  check(
    "a page comes from the worker, with the dashboard's own policy",
    settings?.fromServiceWorker() === true && settings.status() === 200 && policy.includes("default-src 'none'"),
    policy.slice(0, 60),
  );

  const injected = await page.addScriptTag({ content: "window.injected = true" }).then(
    () => page.evaluate(() => "injected" in window),
    () => false,
  );
  check("the browser enforces that policy: an inline script does not run", !injected);

  const statuses: string[] = [];
  for (const tab of TABS) statuses.push(`${tab === "" ? "/" : tab} ${(await page.goto(`${demo}${tab}`))?.status()}`);

  check(
    "every tab answers",
    statuses.every((status) => status.endsWith(" 200")),
    statuses.join("  "),
  );
}

/** Forms change the data, and a site is served with its files. */
async function useIt(walk: Walk, page: Page): Promise<string> {
  const { check, demo } = walk;
  await page.goto(demo);
  const [victim = ""] = await siteNames(page);
  const after = await trash(page, demo, victim);
  await page.goto(demo);
  const left = await siteNames(page);
  await page.goto(`${demo}?view=trash`);
  check(
    "a form changes the data: a site moves to the trash",
    !after.includes(REFUSED) && !left.includes(victim) && (await siteNames(page)).includes(victim),
    victim,
  );

  await page.reload();
  check("a reload keeps the visit", (await siteNames(page)).includes(victim));

  await page.goto(demo);
  const [copied = ""] = await siteNames(page);
  await page.click(`${SITE_LINK}:text-is("${copied}")`);
  await page.fill('form[action$="/duplicate"] input[name="name"]', COPY_NAME);
  await page.click('form[action$="/duplicate"] button[type="submit"]');
  await page.waitForLoadState();
  await page.goto(demo);
  check("a site is duplicated: the copy is listed under its own name", (await siteNames(page)).includes(COPY_NAME), `${copied} -> ${COPY_NAME}`);

  await page.goto(`${demo}settings`);
  await page.click('form[action$="/settings/save"] button[type="submit"]');
  await page.waitForLoadState();
  check("the settings form, with every field of it, is taken", page.url().startsWith(`${demo}settings`) && !(await page.content()).includes(REFUSED), page.url().slice(walk.origin.length));

  await page.goto(demo);
  const served = new URL((await page.locator(SERVED_LINK).first().getAttribute("href")) ?? "", demo).href;
  const answer = await page.goto(served);
  const linked = await page.locator('link[rel="stylesheet"]').count();
  const sheets = await page.evaluate(() => [...document.styleSheets].filter((sheet) => sheet.href !== null && sheet.cssRules.length > 0).length);
  check(
    "a sample site is served with every stylesheet it links",
    answer?.status() === 200 && linked >= 1 && sheets === linked,
    `${served.slice(demo.length)}: ${sheets} of ${linked} stylesheets, "${await page.title()}"`,
  );

  // In a tab of its own: the demo's last tab leaving the demo would end the visit.
  const beside = await page.context().newPage();
  const outside = await beside.goto(`${walk.origin}/another-page/`);
  check("a page outside the demo's folder stays the host's own", outside?.fromServiceWorker() === false && outside.status() === 404);
  await beside.close();

  return victim;
}

/** Chromium alone lets a test stop the worker and reload around it. */
async function stopAndReload(walk: Walk, context: BrowserContext, page: Page, victim: string): Promise<void> {
  const { check, demo } = walk;
  await page.goto(demo);
  const [second = ""] = await siteNames(page);
  await page.click(`${SITE_LINK}:text-is("${second}")`);
  await page.waitForLoadState();

  const devtools = await context.newCDPSession(page);
  await devtools.send("ServiceWorker.enable");
  await devtools.send("ServiceWorker.stopAllWorkers");

  // The page was drawn before the stop: its form carries a token signed before it.
  await page.click(TRASH_BUTTON);
  await page.waitForLoadState();
  const after = await page.content();
  await page.goto(`${demo}?view=trash`);
  const trashed = await siteNames(page);
  check(
    "after the browser stops the worker, an open page's form still works and nothing is lost",
    !after.includes(REFUSED) && second !== victim && trashed.includes(victim) && trashed.includes(second),
    trashed.join(", "),
  );

  await devtools.send("ServiceWorker.stopAllWorkers");
  await page.reload();
  check("a saved demo survives a stop of the worker and a reload", (await siteNames(page)).includes(second), (await siteNames(page)).join(", "));

  // The page before the reload is marked, so the check looks at the page that came back and never at the one that was there.
  await page.goto(`${demo}activity`);
  await page.evaluate(() => document.documentElement.setAttribute("data-before-reload", ""));
  await devtools.send("Page.reload", { ignoreCache: true });
  await page.waitForFunction(() => !document.documentElement.hasAttribute("data-before-reload") && document.querySelector("#preview-bar") !== null, undefined, { timeout: FIRST_LOAD_MS });
  const back = page.url() === `${demo}activity` && (await page.title()).startsWith("Activity");
  check("a forced reload of a deep page, around the worker, comes back to it", back, `${page.url().slice(walk.origin.length)}: "${await page.title()}"`);
}

/** The bar's scheme switch and Reset, and a new visit. */
async function startOver(walk: Walk, context: BrowserContext, opened: Page, victim: string): Promise<void> {
  const { check, demo } = walk;
  await opened.goto(demo);
  await opened.click('#preview-bar a[href*="/theme/dark"]');
  await opened.waitForLoadState();
  await opened.goto(`${demo}tokens`);
  const dark = (await opened.locator("#preview-bar").count()) === 1 && !(await opened.content()).includes(FOLLOWS_SYSTEM);
  check("the scheme switch holds on the next page: the worker keeps the cookie", dark);

  await opened.close();
  const page = await context.newPage();
  await page.goto(demo);
  await page.waitForSelector(SITE_LINK, { timeout: FIRST_LOAD_MS });
  check("a new visit starts over from the seed", (await siteNames(page)).includes(victim) && (await page.content()).includes(FOLLOWS_SYSTEM));

  await trash(page, demo, victim);
  await page.click('#preview-bar form[action$="/reset"] button');
  await page.waitForSelector(SITE_LINK);
  check("the bar's Reset starts over", (await siteNames(page)).includes(victim));
}

/** A browser that never saw the demo opens a page inside it, and one that has no Service Workers opens the demo. */
async function strangers(walk: Walk): Promise<void> {
  const { check, demo } = walk;
  const fresh = await walk.open();
  const deep = await fresh.newPage();
  await deep.goto(`${demo}activity?page=1#content`);
  await deep.waitForSelector("#preview-bar", { timeout: FIRST_LOAD_MS }).catch(() => undefined);
  check(
    "a deep link on a first visit reaches its page, query and fragment kept, through the host's 404 page",
    deep.url() === `${demo}activity?page=1#content` && (await deep.locator("#preview-bar").count()) === 1,
    deep.url().slice(walk.origin.length),
  );
  await fresh.close();

  const without = await walk.open({ serviceWorkers: "block" });
  const blocked = await without.newPage();
  await blocked.goto(demo);
  await blocked.waitForSelector("#blocked:not([hidden])", { timeout: FIRST_LOAD_MS }).catch(() => undefined);
  const said = (await blocked.locator("#blocked").isVisible()) ? ((await blocked.locator("main").textContent()) ?? "").replaceAll("\n", " ") : "";
  check(
    "without Service Workers the page says what the product is and why the demo cannot run",
    said.includes(WHAT_IT_IS) && said.includes("Service Worker"),
    said.slice(0, 120),
  );
  await without.close();
}

async function walkThrough(engine: string, browser: Browser, lines: Pick<Walk, "origin" | "demo" | "check">): Promise<void> {
  const errors: string[] = [];
  const elsewhere = new Set<string>();

  // Every browser the walk opens is watched: for a page's own error, and for a request to any origin but the demo's.
  const open: Walk["open"] = async (options) => {
    const opened = await browser.newContext(options);
    opened.on("weberror", (error) => errors.push(String(error.error())));
    opened.on("request", (request) => {
      if (!request.url().startsWith(`${lines.origin}/`)) elsewhere.add(request.url());
    });

    return opened;
  };
  const walk: Walk = { ...lines, engine, open };
  const context = await open();
  const page = await context.newPage();

  await firstVisit(walk, page);
  const victim = await useIt(walk, page);
  if (walk.engine === "chromium") await stopAndReload(walk, context, page, victim);

  await startOver(walk, context, page, victim);
  await context.close();
  await strangers(walk);

  walk.check("nothing asks another origin", elsewhere.size === 0, [...elsewhere].join(" "));
  walk.check("no page throws an error", errors.length === 0, errors.join(" | "));
}

/** The engines to walk: the ones named, or every one whose browser is installed. */
function wanted(named: readonly string[]): string[] {
  const unknown = named.filter((name) => !Object.hasOwn(ENGINES, name));
  if (unknown.length > 0) throw new TypeError(`no engine called ${unknown.join(", ")}: there are ${Object.keys(ENGINES).join(", ")}`);

  if (named.length > 0) return [...named];

  return Object.entries(ENGINES)
    .filter(([, engine]) => existsSync(engine.executablePath()))
    .map(([name]) => name);
}

const engines = wanted(process.argv.slice(2));
if (engines.length === 0) throw new Error("Playwright has no browser on this machine: install one with `bunx playwright install chromium`");

using folder = mkdtempDisposableSync(join(tmpdir(), "poplin-demo-"));
await buildDemo({ out: folder.path });
const server = serveStatic({ folder: folder.path, at: AT, port: 0 });
const origin = `http://${server.hostname}:${server.port}`;
let failed = 0;
let passed = 0;

try {
  for (const engine of engines) {
    console.log(engine);
    const browser = await (ENGINES[engine] ?? chromium).launch();
    const check: Walk["check"] = (name, ok, note = "") => {
      failed += ok ? 0 : 1;
      passed += ok ? 1 : 0;
      console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${note === "" ? "" : `   ${note}`}`);
    };

    try {
      await walkThrough(engine, browser, { origin, demo: `${origin}${AT}`, check });
    } catch (error) {
      check("the walk ran to its end", false, String(error).slice(0, 600));
    } finally {
      await browser.close();
    }
  }
} finally {
  await server.stop(true);
}

console.log(`${passed} of ${passed + failed} checks passed in ${engines.join(", ")}`);
process.exitCode = failed === 0 ? 0 : 1;
