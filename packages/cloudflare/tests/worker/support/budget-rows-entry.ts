// What a visitor's request, a login, the setup page, an instance's start, and a scheduled run may cost.

import { reset } from "cloudflare:test";
import { dayOf } from "@poplin/core/src/records/views";
import { vi } from "vitest";
import { emptyAccount, TOKEN } from "../../zone/support/fake-install";
import { ADMIN, accessHeaders, cloudflareOf, instance, OWNER, page, shortPages, sweep, type TestFile, under } from "./install";
import { type Budget, type BudgetRow, get, type Group, type Measured, post, published, sessionOf, sql, type Stage, type Step, unmeasured } from "./budget-stage";
import { manyEntries, manyFiles, manySites, siteFolder } from "./budget-seeds";
import { OWN_KEY, ownRelease } from "./own-release";

/** The group of a visitor's requests. */
const VIEW: Group = "One page view of a site";

/** The group of what the dashboard's own addresses answer. */
const SCREEN: Group = "Each dashboard screen";

/** The group of what nobody asks for. */
const BACKGROUND: Group = "Background work";

/** The milliseconds of one UTC day. */
const DAY_MS = 86_400_000;

/** The entries one file of the log holds. */
const FILE_ENTRIES = 2000;

/** The sites one page of the Sites screen holds. */
const SITES_PAGE = 25;

/** The files one removal takes from a folder whose list pages hold one object each. */
const WHOLE_REMOVAL = 15;

/** The sites one step of the sweep looks at. */
const STEP_SITES = 5;

/** The requests of a day so far, all sites together, from which one request in fifty is counted: under the 100,000 a day the first settings allow. */
const BUSY_DAY = 98_000;

/** The requests of one site on that day: under the quarter of the day one site may take. */
const BUSY_SITE = 20_000;

/** A draw that makes no request a sample of a day counted in samples. */
const NO_SAMPLE = 0.999;

/** Writes a test file's text as its bytes. */
const ENCODER = new TextEncoder();

/** The files of a site that holds a page under a folder, a script, and its own page for a missing file. */
const FILES: readonly TestFile[] = [
  page("<h1>report</h1>"),
  { path: "app.js", body: ENCODER.encode("export {};"), type: "text/javascript" },
  { path: "about/index.html", body: ENCODER.encode("<h1>about</h1>"), type: "text/html" },
  { path: "404.html", body: ENCODER.encode("<h1>not here</h1>"), type: "text/html" },
];

/** Count a busy day so far, for all sites and for one: every later request of the day is counted as one sample in fifty. */
async function busyDay(stage: Stage, site: string): Promise<void> {
  const day = dayOf(stage.w.clock.now);
  await sql("INSERT INTO request_counts (day, site, requests, views) VALUES (?1, '', ?3, ?3), (?1, ?2, ?4, ?4)", day, site, BUSY_DAY, BUSY_SITE);
}

/**
 * A visitor's request to a public site made of `FILES`, or of the entry page alone.
 *
 * @param asked - `uncounted` measures the request late in a busy day, as one that is no sample of it
 */
function view(
  name: string,
  budget: Budget,
  asked: { readonly path: string; readonly method?: string; readonly headers?: Record<string, string>; readonly bare?: true; readonly guide?: string; readonly uncounted?: true },
  status: number,
  start?: BudgetRow["start"],
): BudgetRow {
  return {
    group: VIEW,
    name,
    ...(start === undefined ? {} : { start }),
    ...(asked.guide === undefined ? {} : { guide: asked.guide }),
    arrange: async (stage) => {
      const site = await published(stage, { name: "report", access: "public" }, asked.bare === true ? [page("<h1>report</h1>")] : FILES);
      const step: Step = (measured) => get(measured, `${site.addresses.public}${asked.path}`, asked.headers, asked.method);
      if (asked.uncounted !== true) return step;

      await busyDay(stage, site.id);
      // The measured instance keeps the `Math.random` it starts with, so the draw is pinned before it starts. The test file takes the pin off after the row.
      vi.spyOn(Math, "random").mockReturnValue(NO_SAMPLE);

      return step;
    },
    status,
    budget,
  };
}

/** A logged-in visitor's request for the page of a private site. The login is Access's token on the request, checked against keys the instance fetches, not against the database. */
function privateView(name: string, budget: Budget, asked: { readonly start?: BudgetRow["start"]; readonly guide?: string } = {}): BudgetRow {
  return {
    group: VIEW,
    name,
    ...asked,
    arrange: async (stage) => {
      const site = await published(stage, { name: "report" }, FILES);
      const headers = await accessHeaders(stage.w);

      return (measured) => get(measured, `${under(site, "p")}/`, headers);
    },
    status: 200,
    budget,
  };
}

/** A request for what the browser already holds: the tag the first answer carried is sent back. */
function again(name: string, budget: Budget, path: string): BudgetRow {
  return {
    group: VIEW,
    name,
    arrange: async (stage) => {
      const site = await published(stage, { name: "report", access: "public" }, FILES);
      const first = await get(unmeasured(stage), `${site.addresses.public}${path}`);

      return (measured) => get(measured, `${site.addresses.public}${path}`, { "If-None-Match": first.headers.get("ETag") ?? "" });
    },
    status: 304,
    budget,
  };
}

/** A run of the setup page with a token, on an install nobody has logged in to. The run asks Cloudflare, which a stand-in answers, and keeps what it found in the database. */
function setupRun(name: string, budget: Budget, path: string, body: Readonly<Record<string, string>>): BudgetRow {
  return {
    group: SCREEN,
    name,
    arrange: async (stage) => {
      stage.outside.cloudflare = cloudflareOf(emptyAccount(), []);

      return (measured) => post(measured, path, body, {});
    },
    status: 200,
    budget,
  };
}

/** One scheduled run on the measured instance, with the bucket's list pages cut short when asked. */
function run(short: boolean): Step {
  return async (measured: Measured) => {
    await sweep(measured.worker, measured.w, short ? { ...measured.bindings, SITES: shortPages(measured.bindings.SITES) } : measured.bindings);

    return undefined;
  };
}

/** Seed the costliest run there is: the first of a day, on which an update is due, with five sites past their days in the trash that each take a whole removal. */
async function costliestRun(stage: Stage): Promise<void> {
  const { database } = stage.install;
  const release = await ownRelease("999.0.0");
  await database.changeSettings({ auto_update: true }, { by: OWNER, at: stage.w.clock.now });
  stage.w.clock.now = Math.ceil(stage.w.clock.now / DAY_MS) * DAY_MS;
  // The run that learns of the release: an update is started three days after it was first seen.
  await sweep(instance(stage.w, undefined, release.latest), stage.w);
  await manySites(stage, STEP_SITES, { trashed: true });
  for (let site = 1; site <= STEP_SITES; site += 1) await manyFiles(`${siteFolder(site)}/v1/`, WHOLE_REMOVAL);

  stage.w.clock.now += 8 * DAY_MS;
  stage.outside.latest = release.latest;
  stage.outside.cloudflare = release.cloudflare;
  stage.keptKey = OWN_KEY;
}

export const ENTRY_ROWS: readonly BudgetRow[] = [
  // The common view: the instance served the site a moment ago, so it holds the settings and the day's counts. The request is counted, as every one of a day's first 2,000 is.
  view("public site: the page, warm instance", { queries: 2, reads: 1, writes: 0 }, { path: "/", guide: "A visitor opens a page of a public site" }, 200, "warm"),
  // The least a request costs: late in a busy day, one that is no sample of it is written nowhere.
  view("public site: a script, warm instance, not counted", { queries: 1, written: 0, reads: 1, writes: 0 }, { path: "/app.js", uncounted: true }, 200, "warm"),
  // An instance's first request for a site, over a minute after it last read the settings: it reads both. So is every view below that names no start.
  view("public site: the page, the instance's first request for the site", { queries: 3, reads: 1, writes: 0 }, { path: "/" }, 200),
  view("public site: a script", { queries: 3, reads: 1, writes: 0 }, { path: "/app.js" }, 200),
  // Worst hit: a path without an extension is no file's own key, so it is looked for under a second one, where the folder's page is.
  view("public site: a page under a folder", { queries: 3, reads: 2, writes: 0 }, { path: "/about" }, 200),
  // Worst miss: the keys the path could be under hold nothing, and then the site's own page for a missing file is read. Three calls: the most serving ever makes.
  view("public site: no such file, the site's own 404 page", { queries: 3, reads: 3, writes: 0 }, { path: "/nothing" }, 404),
  view("public site: no such file, no 404 page", { queries: 3, reads: 2, writes: 0 }, { path: "/nothing", bare: true }, 404),
  view("public site: part of a page under a folder", { queries: 3, reads: 2, writes: 0 }, { path: "/about", headers: { Range: "bytes=0-3" } }, 206),
  view("public site: HEAD of no such file", { queries: 3, reads: 3, writes: 0 }, { path: "/nothing", method: "HEAD" }, 404),
  // The icon is poplin's own, answered from the Worker once the bucket has said the site holds none.
  view("public site: the default icon", { queries: 3, reads: 1, writes: 0 }, { path: "/favicon.ico", bare: true }, 200),
  view("public site: the page, new instance", { queries: 5, reads: 1, writes: 0 }, { path: "/" }, 200, "new"),
  // A page carries the tag of its site's live version, so a browser that holds it is answered with no read of the bucket.
  again("public site: the page again, unchanged", { queries: 3, reads: 0, writes: 0 }, "/"),
  // Any other file carries its own tag: the bucket is asked once with it, and opens no body.
  again("public site: a script again, unchanged", { queries: 3, reads: 1, writes: 0 }, "/app.js"),
  {
    group: VIEW,
    name: "unlisted site: the page",
    // As a public page: the address differs, the cost does not.
    arrange: async (stage) => {
      const site = await published(stage, { name: "report", access: "unlisted" }, FILES);

      return (measured) => get(measured, `${under(site, "u")}/`);
    },
    status: 200,
    budget: { queries: 2, reads: 1, writes: 0 },
  },
  // The common view: the instance served the site a moment ago, and holds the keys the login is checked against.
  privateView("private site: the page, logged in, warm instance", { queries: 2, reads: 1, writes: 0 }, { start: "warm", guide: "A visitor opens a page of a private site" }),
  privateView("private site: the page, logged in, the instance's first request for the site", { queries: 3, reads: 1, writes: 0 }),
  // The start of the instance adds its queries to the page's.
  privateView("private site: the page, logged in, new instance", { queries: 5, reads: 1, writes: 0 }, { start: "new" }),
  {
    group: VIEW,
    name: "private site: the page, not logged in",
    // A request that came around the login is looked up nowhere.
    arrange: async (stage) => {
      const site = await published(stage, { name: "report" }, FILES);

      return (measured) => get(measured, `${under(site, "p")}/`);
    },
    status: 404,
    budget: { queries: 1, reads: 0, writes: 0 },
  },
  {
    group: VIEW,
    name: "an address of no site",
    // An address in the form of a site's that names none is sent to the address behind the login, as a private site's is: it tells nobody whether the id exists.
    arrange: async () => (measured) => get(measured, "https://nothing--zzzzzzzzzzzz-u-poplin.example.com/"),
    status: 302,
    budget: { queries: 1, reads: 0, writes: 0 },
  },
  {
    group: SCREEN,
    name: "open the dashboard right after a login: the first login of an install",
    // The first login is what leaves the setup page a repair alone. Its line is written to the log by the first page it opens, as every login's is: the users, the line, the frame.
    arrange: async (stage) => {
      const headers = await accessHeaders(stage.w);

      return (measured) => get(measured, `${ADMIN}/`, headers);
    },
    status: 200,
    budget: { queries: 3, reads: 0, writes: 0 },
  },
  {
    group: SCREEN,
    name: "open the dashboard right after a login, new instance",
    start: "new",
    // The start of the instance adds its queries to the page's.
    arrange: async (stage) => {
      const headers = await accessHeaders(stage.w);

      return (measured) => get(measured, `${ADMIN}/`, headers);
    },
    status: 200,
    budget: { queries: 5, reads: 0, writes: 0 },
  },
  {
    group: SCREEN,
    name: "open the dashboard right after a login another instance wrote the line of",
    // An instance asks once about a login that began under five minutes ago, and writes nothing where the line stands.
    arrange: async (stage) => {
      const headers = await accessHeaders(stage.w);
      await get(unmeasured(stage), `${ADMIN}/`, headers);

      return (measured) => get(measured, `${ADMIN}/`, headers);
    },
    status: 200,
    budget: { queries: 3, reads: 0, writes: 0 },
  },
  {
    group: SCREEN,
    name: "the dashboard's page, asked with no token of Access",
    // A request that came around Access is refused after the one read of the users, with nothing of the install.
    arrange: async () => (measured) => get(measured, `${ADMIN}/`),
    status: 403,
    budget: { queries: 1, reads: 0, writes: 0 },
  },
  {
    group: SCREEN,
    name: "the setup page, open",
    // Whether anybody has logged in is asked on every request until somebody has: one entry of the log, found by its index.
    arrange: async () => (measured) => get(measured, `${ADMIN}/setup`),
    status: 200,
    budget: { queries: 2, reads: 0, writes: 0 },
  },
  {
    group: SCREEN,
    name: "the setup page, after the first login, new instance",
    start: "new",
    // The way back in is opened when the dashboard is not: by an instance that has not seen the login yet.
    arrange: async (stage) => {
      await sessionOf(stage);

      return (measured) => get(measured, `${ADMIN}/setup`);
    },
    status: 200,
    budget: { queries: 4, reads: 0, writes: 0 },
  },
  {
    group: SCREEN,
    name: "the setup page: repair after the first login",
    // Worst: the login was removed at Cloudflare and the user's mailbox is lost, so the repair stores one more user, makes its pieces anew, and keeps the run.
    arrange: async (stage) => {
      await sessionOf(stage);
      stage.outside.cloudflare = cloudflareOf(emptyAccount(), []);

      return (measured) => post(measured, "/setup/data/repair", { token: TOKEN, login: "other@example.com" }, {});
    },
    status: 200,
    budget: { queries: 6, reads: 0, writes: 0 },
  },
  setupRun("the setup page: check with a token", { queries: 5, reads: 0, writes: 0 }, "/setup/api/check", { token: TOKEN }),
  // Worst: nothing of the domain is made yet, so the page's own repair makes every piece.
  setupRun("the setup page: repair", { queries: 5, reads: 0, writes: 0 }, "/setup/data/repair", { token: TOKEN }),
  // Worst: a program's repair names another first login, which replaces the stored one before the pieces are made.
  setupRun("the setup page: a program's repair with another first login", { queries: 7, reads: 0, writes: 0 }, "/setup/api/repair", { token: TOKEN, login: "meant@example.com" }),
  {
    group: SCREEN,
    name: "Sites screen: a full page, new instance",
    route: "GET /data/sites",
    start: "new",
    // The screen a person opens first, on an instance that starts with it.
    arrange: async (stage) => {
      await manySites(stage, SITES_PAGE + 1, { versions: 3 });
      const session = await sessionOf(stage);

      return (measured) => get(measured, `${ADMIN}/data/sites`, session);
    },
    status: 200,
    budget: { queries: 4, reads: 0, writes: 0 },
  },
  {
    group: SCREEN,
    name: "Activity screen: download 2,000 entries about 2,000 sites, new instance",
    route: "GET /data/activity/download",
    start: "new",
    // The costliest request of the dashboard, on an instance that starts with it.
    arrange: async (stage) => {
      await manyEntries(stage, FILE_ENTRIES + 200);
      const session = await sessionOf(stage);

      return (measured) => get(measured, `${ADMIN}/data/activity/download?part=1`, session);
    },
    status: 200,
    budget: { queries: 6, reads: 0, writes: 0 },
  },
  {
    group: BACKGROUND,
    name: "the first request of a new install",
    start: "new",
    // Worst start: the database is empty, so the schema is made, the first settings stored, and the visitor key drawn before the request is answered.
    arrange: async () => {
      await reset();

      return (measured) => get(measured, `${ADMIN}/api/whoami`);
    },
    status: 401,
    budget: { queries: 6, read: 52, reads: 0, writes: 0 },
  },
  {
    group: BACKGROUND,
    name: "the first request of a new instance",
    start: "new",
    // What a start adds to any request: the schema's step read, the settings, and the visitor key.
    arrange: async () => (measured) => get(measured, `${ADMIN}/api/whoami`),
    status: 401,
    budget: { queries: 2, read: 3, reads: 0, writes: 0 },
  },
  {
    group: BACKGROUND,
    name: "scheduled run: nothing due",
    // Every run but a day's first, on an install with nothing to remove.
    arrange: async (stage) => {
      await manySites(stage, 10);
      await sweep(unmeasured(stage).worker, stage.w);

      return run(false);
    },
    status: undefined,
    budget: { queries: 6, reads: 0, writes: 0 },
  },
  {
    group: BACKGROUND,
    name: "scheduled run: the costliest, new instance",
    start: "new",
    // Worst: Cloudflare starts an instance for the run, the day's first, on which an update is due, and the walk's first step meets five sites past the trash that each take a whole removal of 15 list pages.
    // By its own count a run stops at 40 queries, and the start of its instance adds to them: a costlier run than this one fails here before it is cut off.
    arrange: async (stage) => {
      await costliestRun(stage);

      return run(true);
    },
    status: undefined,
    budget: { queries: 24, reads: 0, writes: 75, deletes: 75 },
  },
];
