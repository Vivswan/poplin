// What each data route of the dashboard may cost, and the page around them: one row a route, seeded for the worst the product's own limits let it meet.

import type { DataRoutes } from "@poplin/app/src/console/routes";
import { OWN_SCHEMA } from "@poplin/core/src/database/open";
import type { hc, InferRequestType } from "hono/client";
import { INSTALL_OBJECTS } from "../../../src/zone/install-objects";
import { emptyAccount, TOKEN } from "../../zone/support/fake-install";
import { ADMIN, cloudflareOf, done, OWNER } from "./install";
import { type Budget, type BudgetRow, get, type Measured, post, sessionOf, sql, type Stage, unmeasured } from "./budget-stage";
import { endedTokens, manyEntries, manyProblems, manySites, manyTokens, newLinks, siteId, siteWithFiles, tokenId, waitingLogins } from "./budget-seeds";

/** The group of every row here. */
const group = "Each dashboard screen";

/** Give the measured install a key, and an account that holds the policy of its logins, so a change of the users is carried there. */
function carriesUsers(stage: Stage): void {
  const account = emptyAccount();
  account.policies.push({ id: "policy-1", name: INSTALL_OBJECTS.accessPolicy, decision: "allow", include: [{ email: { email: OWNER } }] });
  stage.outside.cloudflare = cloudflareOf(account, []);
  stage.keptKey = TOKEN;
}

/** A release newer than any build, as the install keeps it once it has learned of one. */
const NEWER = { version: "999.0.0", released: "2026-12-01", notes: "https://example.com/changelog/#v999-0-0", schema: OWN_SCHEMA + 1 };

/** An address the provider starts a rebuild at, in the form Cloudflare gives a Deploy Hook. */
const HOOK = "https://api.cloudflare.com/client/v4/workers/builds/deploy_hooks/a1b2c3d4-e5f6-7890-abcd-ef1234567890";

/** The versions a site keeps under the first settings of the tests' install. */
const KEPT = 3;

/** The files of a version the bucket lists in two pages: one more than a page holds. */
const TWO_PAGES = 1001;

/** The sites one page of the Sites screen holds. */
const SITES_PAGE = 25;

/** The entries the largest page of the Activity screen holds. */
const ACTIVITY_PAGE = 200;

/** The entries one file of the log holds. */
const FILE_ENTRIES = 2000;

/** The entries a count of the whole log reads at the most. */
const MOST_COUNTED = 10_000;

/** The sites the graph of visits compares at the most, and the days it reads at the most. */
const GRAPH = { sites: 50, days: 365 } as const;

/** The logins of computers that may wait at one moment, all visitors together. */
const MOST_WAITING = 50;

/** The files one request of a copy copies, for a site of up to a thousand files. */
const COPIED_AT_ONCE = 112;

/** The label of the made-up site 1, as the dashboard's addresses name a site. */
const LABEL = `site-1--${siteId(1)}`;

/** A decision of a login as its route takes it: a change of that shape does not compile here. */
type Decision = InferRequestType<ReturnType<typeof hc<DataRoutes>>["logins"]["decide"]["$post"]>["json"];

/** Ask a data route of the measured dashboard under a session. */
function data(measured: Measured, session: Record<string, string>, path: string): Promise<Response> {
  return get(measured, `${ADMIN}/data${path}`, session);
}

/** Keep everything the frame reads: a newer release, the address a rebuild starts at, and a domain check that found a piece to fix. */
async function fullFrame(stage: Stage): Promise<void> {
  const { now } = stage.w.clock;
  await stage.install.database.keepUpdateCheck({ checked_at: now, news: NEWER });
  await stage.install.database.keepUpdateAddress(HOOK, { by: OWNER, at: now });
  await sql(`INSERT INTO domain_check (id, ran_at, ran_by, run, pieces, users_changed_at) VALUES (1, ?1, ?2, 'check', '[]', ?1)`, now, OWNER);
}

/** Begin a copy of a site of 1,001 files as the Sites screen does, unmeasured: its first request copies 113 files and names the upload the later ones go on with. */
async function begunCopy(stage: Stage): Promise<{ readonly upload: string; readonly session: Record<string, string> }> {
  await siteWithFiles(stage, TWO_PAGES);
  const session = await sessionOf(stage);
  const begun = await done<{ copy: { upload: string } }>(await post(unmeasured(stage), `/data/sites/${LABEL}/duplicate`, { name: "copy" }, session));

  return { upload: begun.copy.upload, session };
}

/** A change of the made-up site 1, kept in every version it may keep, sent as the Sites screen sends it. */
function siteChange(name: string, budget: Budget, change: string, body: unknown, why: { readonly trashed?: boolean } = {}): BudgetRow {
  return {
    group,
    name,
    route: `POST /data/sites/:site/${change}`,
    arrange: async (stage) => {
      await manySites(stage, 1, { versions: KEPT, ...why });
      const session = await sessionOf(stage);

      return (measured) => post(measured, `/data/sites/${LABEL}/${change}`, body, session);
    },
    status: 200,
    budget,
  };
}

export const CONSOLE_ROWS: readonly BudgetRow[] = [
  {
    group,
    name: "open the dashboard: the page",
    // Worst: the frame has a newer release, a rebuild address, and a note on the domain to read, and it is the instance's first page, which asks once whether anybody has logged in. Every later page is one query less.
    arrange: async (stage) => {
      await fullFrame(stage);
      const session = await sessionOf(stage);

      return (measured) => get(measured, `${ADMIN}/`, session);
    },
    status: 200,
    budget: { queries: 3, reads: 0, writes: 0 },
  },
  {
    group,
    name: "the frame around every screen",
    route: "GET /data/frame",
    // Worst: the frame has a newer release, a rebuild address, and a note on the domain to read.
    arrange: async (stage) => {
      await fullFrame(stage);
      const session = await sessionOf(stage);

      return (measured) => data(measured, session, "/frame");
    },
    status: 200,
    budget: { queries: 2, reads: 0, writes: 0 },
  },
  {
    group,
    name: "start an update from the frame",
    route: "POST /data/update",
    // Worst: an address is saved and a newer release is known, so the build is started and the start written to the log.
    arrange: async (stage) => {
      await fullFrame(stage);
      stage.outside.rebuild = async () => new Response(null, { status: 204 });
      const session = await sessionOf(stage);

      return (measured) => post(measured, "/data/update", {}, session);
    },
    status: 200,
    budget: { queries: 5, reads: 0, writes: 0 },
  },
  {
    group,
    name: "Sites screen: a full page, searched and sorted",
    guide: "Open the Sites screen",
    route: "GET /data/sites",
    // Worst for the queries: a full page of 25 with another behind it, found by a search and ordered by title, each site keeping every version it may, each version published by a token of its own to name.
    // The rows read are this seed's: a search passes over every site that does not match, and no setting bounds the sites.
    arrange: async (stage) => {
      await manySites(stage, SITES_PAGE + 1, { versions: KEPT });
      const session = await sessionOf(stage);

      return (measured) => data(measured, session, "/sites?q=site&sort=title&dir=desc");
    },
    status: 200,
    budget: { queries: 2, read: 651, reads: 0, writes: 0 },
  },
  {
    group,
    name: "Sites screen: one site's panel",
    route: "GET /data/sites/:site",
    // Worst: the site keeps every version it may, each published by a token of its own to name.
    arrange: async (stage) => {
      await manySites(stage, 1, { versions: KEPT });
      const session = await sessionOf(stage);

      return (measured) => data(measured, session, `/sites/${LABEL}`);
    },
    status: 200,
    budget: { queries: 2, reads: 0, writes: 0 },
  },
  {
    group,
    name: "Sites screen: the address of a public name",
    route: "GET /data/public-address",
    // The address is written from the name alone: nothing is read for it.
    arrange: async (stage) => {
      const session = await sessionOf(stage);

      return (measured) => data(measured, session, "/public-address?name=report");
    },
    status: 200,
    budget: { queries: 1, reads: 0, writes: 0 },
  },
  siteChange("Sites screen: rename a site and set its title", { queries: 3, reads: 0, writes: 0 }, "naming", { name: "renamed", title: "A title" }),
  siteChange("Sites screen: make a site public under a name", { queries: 3, reads: 0, writes: 0 }, "access", { access: "public", public_name: "report-page" }),
  siteChange("Sites screen: change a site's switches", { queries: 3, reads: 0, writes: 0 }, "settings", { search_engines: true, embeddable: false }),
  siteChange("Sites screen: set when a site deletes itself", { queries: 3, reads: 0, writes: 0 }, "expiry", { expires: "7d" }),
  siteChange("Sites screen: make an older version live", { queries: 3, reads: 0, writes: 0 }, "make-live", { version: 2 }),
  siteChange("Sites screen: new link", { queries: 3, read: 745, reads: 0, writes: 0 }, "new-link", {}),
  siteChange("Sites screen: delete a site", { queries: 3, reads: 0, writes: 0 }, "delete", {}),
  siteChange("Sites screen: restore a site", { queries: 3, reads: 0, writes: 0 }, "restore", {}, { trashed: true }),
  {
    group,
    name: "Sites screen: delete a site in the trash for good, 1,001 files",
    route: "POST /data/sites/:site/delete-for-good",
    // The site is read to see that it is in the trash, then removed as the API removes one: a page of 1,000 files listed and deleted, 15 pages at the most, the rest left to the scheduled run.
    // Seeded with two pages: the queries are the same for any count, and each page more is one listing more.
    arrange: async (stage) => {
      await siteWithFiles(stage, TWO_PAGES, { trashed: true });
      const session = await sessionOf(stage);

      return (measured) => post(measured, `/data/sites/${LABEL}/delete-for-good`, {}, session);
    },
    status: 200,
    budget: { queries: 7, reads: 0, writes: 2, deletes: 2 },
  },
  {
    group,
    name: "Sites screen: duplicate a site of 112 files, whole in one request",
    route: "POST /data/sites/:site/duplicate",
    // Worst of a small copy: as many files as one request copies, so the same request stages the copy, copies every file, lists it again, and makes the site.
    arrange: async (stage) => {
      await siteWithFiles(stage, COPIED_AT_ONCE);
      const session = await sessionOf(stage);

      return (measured) => post(measured, `/data/sites/${LABEL}/duplicate`, { name: "copy" }, session);
    },
    status: 200,
    budget: { queries: 9, reads: 112, writes: 114 },
  },
  {
    group,
    name: "Sites screen: duplicate a site of 1,001 files: first request",
    route: "POST /data/sites/:site/duplicate",
    // Worst of a first request: a version listed in two pages, where a request copies the most files it ever does.
    arrange: async (stage) => {
      await siteWithFiles(stage, TWO_PAGES);
      const session = await sessionOf(stage);

      return (measured) => post(measured, `/data/sites/${LABEL}/duplicate`, { name: "copy" }, session);
    },
    status: 200,
    budget: { queries: 5, reads: 113, writes: 115 },
  },
  {
    group,
    name: "Sites screen: duplicate a site of 1,001 files: a later request",
    route: "POST /data/sites/:site/duplicate",
    // Worst of a later request: the copy is listed for what it lacks, and as many more files are copied.
    arrange: async (stage) => {
      const begun = await begunCopy(stage);

      return (measured) => post(measured, `/data/sites/${LABEL}/duplicate`, { upload: begun.upload }, begun.session);
    },
    status: 200,
    budget: { queries: 4, reads: 113, writes: 114 },
  },
  {
    group,
    name: "Sites screen: cancel a copy of 1,001 files after its first request",
    route: "POST /data/copies/:upload/cancel",
    // Worst: the copy holds as many files as one request copies, 113, which one listing finds and one removal takes away.
    arrange: async (stage) => {
      const begun = await begunCopy(stage);

      return (measured) => post(measured, `/data/copies/${begun.upload}/cancel`, {}, begun.session);
    },
    status: 200,
    budget: { queries: 4, reads: 0, writes: 1, deletes: 1 },
  },
  {
    group,
    name: "Access screen: the logins that wait",
    guide: "Open the Access screen",
    route: "GET /data/logins",
    // Worst: as many logins wait as may at one moment, 50, of which the screen lists 10.
    arrange: async (stage) => {
      await waitingLogins(stage, MOST_WAITING);
      const session = await sessionOf(stage);

      return (measured) => data(measured, session, "/logins");
    },
    status: 200,
    budget: { queries: 2, reads: 0, writes: 0 },
  },
  {
    group,
    name: "Access screen: one waiting login",
    route: "GET /data/logins/:login",
    // Worst: as many logins wait as may. The one is read by its id.
    arrange: async (stage) => {
      await waitingLogins(stage, MOST_WAITING);
      const session = await sessionOf(stage);
      const listed = await done<{ logins: readonly { id: string }[] }>(await data(unmeasured(stage), session, "/logins"));

      return (measured) => data(measured, session, `/logins/${listed.logins.at(-1)?.id}`);
    },
    status: 200,
    budget: { queries: 2, reads: 0, writes: 0 },
  },
  {
    group,
    name: "Access screen: allow a login",
    route: "POST /data/logins/decide",
    // Worst: as many logins wait as may, and the one is allowed as the admin it asked to be: the login is read first, for its code and what it asked, then written with its audit entry.
    arrange: async (stage) => {
      const [login = { id: "", code: "" }] = await waitingLogins(stage, MOST_WAITING, "admin");
      const session = await sessionOf(stage);

      const decision: Decision = { login: login.id, allow: true, scope: "admin", letters: login.code.slice(-4) };

      return (measured) => post(measured, "/data/logins/decide", decision, session);
    },
    status: 200,
    budget: { queries: 3, reads: 0, writes: 0 },
  },
  {
    group,
    name: "Access screen: the people",
    guide: "Open the Access screen",
    route: "GET /data/people",
    // The logins are one setting, read with the rest; the tokens each user allowed are counted in a statement of their own.
    arrange: async (stage) => {
      const session = await sessionOf(stage);

      return (measured) => data(measured, session, "/people");
    },
    status: 200,
    budget: { queries: 2, reads: 0, writes: 0 },
  },
  {
    group,
    name: "Access screen: add a person",
    route: "POST /data/people/add",
    // One setting written, its audit entry, and the mark that the domain's users changed.
    arrange: async (stage) => {
      const session = await sessionOf(stage);

      return (measured) => post(measured, "/data/people/add", { login: "second@example.com" }, session);
    },
    status: 200,
    budget: { queries: 2, reads: 0, writes: 0 },
  },
  {
    group,
    name: "Access screen: remove a person",
    route: "POST /data/people/remove",
    // Worst: another person is listed, so the removal is taken and written.
    arrange: async (stage) => {
      const session = await sessionOf(stage);
      await done(await post(unmeasured(stage), "/data/people/add", { login: "second@example.com" }, session));

      return (measured) => post(measured, "/data/people/remove", { login: "second@example.com" }, session);
    },
    status: 200,
    budget: { queries: 2, reads: 0, writes: 0 },
  },
  {
    group,
    name: "Access screen: add a person, carried to Cloudflare",
    route: "POST /data/people/add",
    // On an install that holds its key the users are then written into Cloudflare's policy, between two statements more: the users read under a mark, and the change settled.
    arrange: async (stage) => {
      const session = await sessionOf(stage);
      carriesUsers(stage);

      return (measured) => post(measured, "/data/people/add", { login: "second@example.com" }, session);
    },
    status: 200,
    budget: { queries: 4, reads: 0, writes: 0 },
  },
  {
    group,
    name: "Access screen: remove a person, carried to Cloudflare",
    route: "POST /data/people/remove",
    // As above: the removal, then the two statements around the write to Cloudflare.
    arrange: async (stage) => {
      const session = await sessionOf(stage);
      await done(await post(unmeasured(stage), "/data/people/add", { login: "second@example.com" }, session));
      carriesUsers(stage);

      return (measured) => post(measured, "/data/people/remove", { login: "second@example.com" }, session);
    },
    status: 200,
    budget: { queries: 4, reads: 0, writes: 0 },
  },
  {
    group,
    name: "Access screen: the tokens",
    guide: "Open the Access screen",
    route: "GET /data/tokens",
    // Worst: many tokens work, 100 here since no setting bounds them, and more ended than the 50 the screen lists.
    arrange: async (stage) => {
      await manyTokens(stage, 100);
      await endedTokens(stage, 51);
      const session = await sessionOf(stage);

      return (measured) => data(measured, session, "/tokens?sort=name&dir=desc");
    },
    status: 200,
    budget: { queries: 2, read: 153, reads: 0, writes: 0 },
  },
  {
    group,
    name: "Access screen: remove a token",
    route: "POST /data/tokens/:token/remove",
    // One token and one audit entry.
    arrange: async (stage) => {
      await manyTokens(stage, 1);
      const session = await sessionOf(stage);

      return (measured) => post(measured, `/data/tokens/${tokenId(1)}/remove`, {}, session);
    },
    status: 200,
    budget: { queries: 2, reads: 0, writes: 0 },
  },
  {
    group,
    name: "Activity screen: 200 entries about 200 sites",
    guide: "Open the Activity screen",
    route: "GET /data/activity",
    // Worst: the largest page, every entry about a site of its own that has since taken a new link, and by a token of its own. The ids are read 100 to a query, twice: as sites, then as ids given up.
    arrange: async (stage) => {
      await manySites(stage, ACTIVITY_PAGE + 1);
      await manyEntries(stage, ACTIVITY_PAGE + 1);
      await newLinks(ACTIVITY_PAGE + 1);
      const session = await sessionOf(stage);

      return (measured) => data(measured, session, `/activity?size=${ACTIVITY_PAGE}`);
    },
    status: 200,
    budget: { queries: 2, read: 603, reads: 0, writes: 0 },
  },
  {
    group,
    name: "Activity screen: narrowed to a site with no entries",
    route: "GET /data/activity",
    // Worst: a page narrowed to a site no entry is about, so the 5,000 newest entries of a longer log are looked through and none is found.
    arrange: async (stage) => {
      await manySites(stage, 11);
      await manyEntries(stage, 6000, 10);
      const session = await sessionOf(stage);

      return (measured) => data(measured, session, `/activity?size=${ACTIVITY_PAGE}&of=${siteId(11)}`);
    },
    status: 200,
    budget: { queries: 3, read: 5011, reads: 0, writes: 0 },
  },
  {
    group,
    name: "Activity screen: the count of entries",
    guide: "Open the Activity screen",
    route: "GET /data/activity/total",
    // A long log: the count is read off its two ends, so it costs what a short one does.
    arrange: async (stage) => {
      await manyEntries(stage, MOST_COUNTED + 1, 10);
      const session = await sessionOf(stage);

      return (measured) => data(measured, session, "/activity/total");
    },
    status: 200,
    budget: { queries: 2, read: 4, reads: 0, writes: 0 },
  },
  {
    group,
    name: "Activity screen: download 2,000 entries about 2,000 sites",
    guide: "Download a file of the Activity log",
    route: "GET /data/activity/download",
    // Worst: a full file, every entry about a site of its own that is gone for good and by a token of its own, with the log going on behind it.
    arrange: async (stage) => {
      await manyEntries(stage, FILE_ENTRIES + 200);
      const session = await sessionOf(stage);

      return (measured) => data(measured, session, "/activity/download?part=1");
    },
    status: 200,
    budget: { queries: 4, read: 2003, reads: 0, writes: 0 },
  },
  {
    group,
    name: "Activity screen: where the next file goes on",
    route: "GET /data/activity/download/next",
    // Worst: the log holds more than a file, so the end of a full file of 2,000 is looked for a reading at a time.
    arrange: async (stage) => {
      await manyEntries(stage, FILE_ENTRIES + 200);
      const session = await sessionOf(stage);

      return (measured) => data(measured, session, "/activity/download/next");
    },
    status: 200,
    budget: { queries: 3, read: 2004, reads: 0, writes: 0 },
  },
  {
    group,
    name: "Usage screen",
    guide: "Open the Usage screen",
    route: "GET /data/usage",
    // The totals are one row the database keeps, and the day's requests another.
    arrange: async (stage) => {
      await manySites(stage, 100, { versions: KEPT });
      const session = await sessionOf(stage);

      return (measured) => data(measured, session, "/usage");
    },
    status: 200,
    budget: { queries: 3, reads: 0, writes: 0 },
  },
  {
    group,
    name: "Usage screen: the problems of 30 days",
    guide: "Open the Usage screen",
    route: "GET /data/problems",
    // Worst: every kind was noted on each of the 30 days kept.
    arrange: async (stage) => {
      await manyProblems(stage, 30);
      const session = await sessionOf(stage);

      return (measured) => data(measured, session, "/problems?days=30");
    },
    status: 200,
    budget: { queries: 2, read: 332, reads: 0, writes: 0 },
  },
  {
    group,
    name: "Usage screen: a year of visits, 50 sites compared",
    guide: "Open the Usage screen",
    route: "GET /data/usage/visits",
    // Worst: the longest stretch, 365 days, and as many sites beside all sites as the graph compares, 50, each with a count on every day.
    arrange: async (stage) => {
      await manySites(stage, GRAPH.sites);
      await sql(
        `WITH RECURSIVE days(d) AS (SELECT 0 UNION ALL SELECT d + 1 FROM days WHERE d < ?1 - 1), counted(n) AS (SELECT 0 UNION ALL SELECT n + 1 FROM counted WHERE n < ?2)
         INSERT INTO request_counts (day, site, requests, views) SELECT date(?3 / 1000, 'unixepoch', '-' || d || ' days'), CASE n WHEN 0 THEN '' ELSE printf('%012d', n) END, 9, 3 FROM days, counted`,
        GRAPH.days,
        GRAPH.sites,
        stage.w.clock.now,
      );
      const session = await sessionOf(stage);
      const sites = Array.from({ length: GRAPH.sites }, (_site, at) => siteId(at + 1)).join(",");

      return (measured) => data(measured, session, `/usage/visits?range=${GRAPH.days}&sites=${sites}`);
    },
    status: 200,
    budget: { queries: 3, read: 37383, reads: 0, writes: 0 },
  },
  {
    group,
    name: "Settings screen",
    guide: "Open the Settings screen",
    route: "GET /data/settings",
    // Worst: a rebuild address is saved, which the screen reads beside the settings.
    arrange: async (stage) => {
      await fullFrame(stage);
      const session = await sessionOf(stage);

      return (measured) => data(measured, session, "/settings");
    },
    status: 200,
    budget: { queries: 2, reads: 0, writes: 0 },
  },
  {
    group,
    name: "Settings screen: save",
    route: "POST /data/settings",
    // Worst: several settings change together, which are read, written, and noted in the log.
    arrange: async (stage) => {
      const session = await sessionOf(stage);

      return (measured) => post(measured, "/data/settings", { texts: { trash_days: "9", versions_kept: "5", max_sites: "100" } }, session);
    },
    status: 200,
    budget: { queries: 3, reads: 0, writes: 0 },
  },
  {
    group,
    name: "Settings screen: save a rebuild address",
    route: "POST /data/settings/update-address",
    // Worst: another address is saved already, which the new one replaces.
    arrange: async (stage) => {
      await fullFrame(stage);
      const session = await sessionOf(stage);

      return (measured) => post(measured, "/data/settings/update-address", { address: `${HOOK.slice(0, -1)}1` }, session);
    },
    status: 200,
    budget: { queries: 2, reads: 0, writes: 0 },
  },
  {
    group,
    name: "Settings screen: remove the rebuild address",
    route: "POST /data/settings/update-address/remove",
    // Worst: one is saved, so it is removed and the removal written to the log.
    arrange: async (stage) => {
      await fullFrame(stage);
      const session = await sessionOf(stage);

      return (measured) => post(measured, "/data/settings/update-address/remove", {}, session);
    },
    status: 200,
    budget: { queries: 2, reads: 0, writes: 0 },
  },
  {
    group,
    name: "Settings screen: sign everyone out",
    route: "POST /data/settings/sign-everyone-out",
    // A new visitor key and one audit entry.
    arrange: async (stage) => {
      const session = await sessionOf(stage);

      return (measured) => post(measured, "/data/settings/sign-everyone-out", {}, session);
    },
    status: 200,
    budget: { queries: 2, reads: 0, writes: 0 },
  },
  {
    group,
    name: "Domain screen",
    guide: "Open the Domain screen",
    route: "GET /data/domain",
    // Worst: a run was kept, so its pieces are read.
    arrange: async (stage) => {
      await fullFrame(stage);
      const session = await sessionOf(stage);

      return (measured) => data(measured, session, "/domain");
    },
    status: 200,
    budget: { queries: 2, reads: 0, writes: 0 },
  },
  {
    group,
    name: "Domain screen: check",
    route: "POST /data/domain/check",
    // The run asks Cloudflare, not the database: what it found is kept in one row with its audit entry.
    arrange: async (stage) => {
      stage.outside.cloudflare = cloudflareOf(emptyAccount(), []);
      const session = await sessionOf(stage);

      return (measured) => post(measured, "/data/domain/check", { token: TOKEN }, session);
    },
    status: 200,
    budget: { queries: 4, reads: 0, writes: 0 },
  },
  {
    group,
    name: "Domain screen: repair",
    route: "POST /data/domain/repair",
    // Worst: nothing of the domain is made yet, so the run makes every piece, and keeps what it did in one row with its audit entry.
    arrange: async (stage) => {
      stage.outside.cloudflare = cloudflareOf(emptyAccount(), []);
      const session = await sessionOf(stage);

      return (measured) => post(measured, "/data/domain/repair", { token: TOKEN }, session);
    },
    status: 200,
    budget: { queries: 4, reads: 0, writes: 0 },
  },
  {
    group,
    name: "a data route with no session",
    // The door: a request that proves nothing reads the settings and the key its session would be checked with, and no more.
    arrange: async () => (measured) => data(measured, {}, "/sites"),
    status: 401,
    budget: { queries: 1, reads: 0, writes: 0 },
  },
  {
    group,
    name: "a file of the dashboard's client",
    // The client's files ride in the Worker: the users are read with the settings to admit the request, and nothing else.
    arrange: async (stage) => {
      const session = await sessionOf(stage);

      return (measured) => get(measured, `${ADMIN}/favicon.ico`, session);
    },
    status: 200,
    budget: { queries: 1, reads: 0, writes: 0 },
  },
];
