// What each route of the API may cost: one row a route, seeded for the worst the product's own limits let it meet.

import { decideLogin } from "@poplin/core/src/actions/computer-logins";
import { ADMIN, done, OWNER } from "./install";
import { adminToken, apiOf, type BudgetRow, get, sql, type Stage, unmeasured } from "./budget-stage";
import { manyEntries, manyProblems, manySites, manyTokens, siteId, siteWithFiles, tokenId, waitingLogins } from "./budget-seeds";

/** The group of every row here. */
const group = "CLI / agent actions";

/** A release newer than any build, as the install keeps it once it has learned of one. */
const NEWER = { version: "999.0.0", released: "2026-12-01", notes: "https://example.com/changelog/#v999-0-0", database: true };

/** An address the provider starts a rebuild at, in the form Cloudflare gives a Deploy Hook. */
const HOOK = "https://api.cloudflare.com/client/v4/workers/builds/deploy_hooks/a1b2c3d4-e5f6-7890-abcd-ef1234567890";

/** The largest page a listing of the API answers. */
const LARGEST_PAGE = 100;

/** The versions a site keeps under the first settings of the tests' install. */
const KEPT = 3;

/** The owner as the rule book's actor. */
const ADMIN_ACTOR = { scope: "admin", holder: OWNER } as const;

/** Keep a newer release and the address a rebuild starts at, so every route that names either has both to read. */
async function knownUpdate(stage: Stage): Promise<void> {
  await stage.install.database.keepUpdateCheck({ checked_at: stage.w.clock.now, news: NEWER });
  await stage.install.database.keepUpdateAddress(HOOK, { by: OWNER, at: stage.w.clock.now });
}

export const API_ROWS: readonly BudgetRow[] = [
  {
    group,
    name: "who am I",
    route: "GET /api/whoami",
    // Worst: a newer release is known, so the answer reads it beside the token and the settings.
    arrange: async (stage) => {
      await knownUpdate(stage);
      const token = await adminToken(stage);

      return (measured) => apiOf(measured, token).whoami.$get({ query: {} });
    },
    status: 200,
    budget: { queries: 3, reads: 0, writes: 0 },
  },
  {
    group,
    name: "log out: remove the token that asks",
    route: "DELETE /api/token",
    // One token and one audit entry, whatever the install holds.
    arrange: async (stage) => {
      const token = await adminToken(stage);

      return (measured) => apiOf(measured, token).token.$delete({ query: {} });
    },
    status: 200,
    budget: { queries: 2, reads: 0, writes: 0 },
  },
  {
    group,
    name: "list the tokens",
    route: "GET /api/tokens",
    // Worst: many tokens. No setting bounds them, so 100 stand for an install that hands them out freely: the listing is one query however many.
    arrange: async (stage) => {
      await manyTokens(stage, 100);
      const token = await adminToken(stage);

      return (measured) => apiOf(measured, token).tokens.$get({ query: {} });
    },
    status: 200,
    budget: { queries: 2, read: 102, reads: 0, writes: 0 },
  },
  {
    group,
    name: "make a token",
    route: "POST /api/tokens",
    // One row and one audit entry.
    arrange: async (stage) => {
      const token = await adminToken(stage);

      return (measured) => apiOf(measured, token).tokens.$post({ query: {}, json: { scope: "publisher", note: "a laptop" } });
    },
    status: 200,
    budget: { queries: 2, reads: 0, writes: 0 },
  },
  {
    group,
    name: "remove another token",
    route: "DELETE /api/tokens/:token",
    // One token and one audit entry.
    arrange: async (stage) => {
      await manyTokens(stage, 1);
      const token = await adminToken(stage);

      return (measured) => apiOf(measured, token).tokens[":token"].$delete({ param: { token: tokenId(1) }, query: {} });
    },
    status: 200,
    budget: { queries: 2, reads: 0, writes: 0 },
  },
  {
    group,
    name: "computer login: start",
    route: "POST /api/logins",
    // Worst: as many logins wait as may at one moment, 50, so this one takes the place of the oldest.
    arrange: async (stage) => {
      const json = { scope: "publisher", computer: "laptop" } as const;
      await waitingLogins(stage, 50);

      return (measured) => apiOf(measured, null).logins.$post({ query: {}, json });
    },
    status: 200,
    budget: { queries: 2, reads: 0, writes: 0 },
  },
  {
    group,
    name: "computer login: poll, allowed",
    route: "POST /api/logins/token",
    // Worst: the login was allowed, so the poll makes the token and removes the login.
    arrange: async (stage) => {
      const begun = await done<{ code: string; secret: string }>(await apiOf(unmeasured(stage), null).logins.$post({ query: {}, json: { scope: "publisher", computer: "laptop" } }));
      const decided = await decideLogin(stage.install, ADMIN_ACTOR, { login: begun.secret.split("_")[2] ?? "", allow: true, scope: "publisher", letters: begun.code });
      if (!decided.ok) throw new Error(`the row's login was not allowed: ${decided.code}`);

      return (measured) => apiOf(measured, null).logins.token.$post({ query: {}, json: { secret: begun.secret } });
    },
    status: 200,
    budget: { queries: 3, reads: 0, writes: 0 },
  },
  {
    group,
    name: "list the sites, largest page",
    route: "GET /api/sites",
    // Worst: a full page of 100 with another behind it, every site keeping as many versions as the setting lets it.
    arrange: async (stage) => {
      await manySites(stage, LARGEST_PAGE + 1, { versions: KEPT });
      const token = await adminToken(stage);

      return (measured) => apiOf(measured, token).sites.$get({ query: { limit: String(LARGEST_PAGE) } });
    },
    status: 200,
    budget: { queries: 2, read: 1213, reads: 0, writes: 0 },
  },
  {
    group,
    name: "show one site",
    route: "GET /api/sites/:site",
    // Worst: the site keeps as many versions as the setting lets it.
    arrange: async (stage) => {
      await manySites(stage, 1, { versions: KEPT });
      const token = await adminToken(stage);

      return (measured) => apiOf(measured, token).sites[":site"].$get({ param: { site: siteId(1) }, query: {} });
    },
    status: 200,
    budget: { queries: 3, reads: 0, writes: 0 },
  },
  {
    group,
    name: "change a site: every setting at once",
    route: "PATCH /api/sites/:site",
    // Worst: the access, the public name, the name, the title, and each switch change in one request, so the access and the details are both written.
    arrange: async (stage) => {
      await manySites(stage, 1, { versions: KEPT });
      const token = await adminToken(stage);
      const json = { access: "public", public_name: "report-page", name: "renamed", title: "A title", search_engines: true, embeddable: false, expires: "7d" } as const;

      return (measured) => apiOf(measured, token).sites[":site"].$patch({ param: { site: siteId(1) }, query: {}, json });
    },
    status: 200,
    budget: { queries: 4, reads: 0, writes: 0 },
  },
  {
    group,
    name: "go back to an older version",
    route: "POST /api/sites/:site/rollback",
    // Worst: the site keeps as many versions as the setting lets it; one of them is made live.
    arrange: async (stage) => {
      await manySites(stage, 1, { versions: KEPT });
      const token = await adminToken(stage);

      return (measured) => apiOf(measured, token).sites[":site"].rollback.$post({ param: { site: siteId(1) }, query: {}, json: { version: 2 } });
    },
    status: 200,
    budget: { queries: 3, reads: 0, writes: 0 },
  },
  {
    group,
    name: "new link",
    route: "POST /api/sites/:site/new-link",
    // The id is drawn anew, and the one given up is kept for the log.
    arrange: async (stage) => {
      await manySites(stage, 1, { versions: KEPT });
      const token = await adminToken(stage);

      return (measured) => apiOf(measured, token).sites[":site"]["new-link"].$post({ param: { site: siteId(1) }, query: {} });
    },
    status: 200,
    budget: { queries: 3, read: 746, reads: 0, writes: 0 },
  },
  {
    group,
    name: "delete a site: to the trash",
    route: "DELETE /api/sites/:site",
    // The trash takes one write, whatever the site holds.
    arrange: async (stage) => {
      await manySites(stage, 1, { versions: KEPT });
      const token = await adminToken(stage);

      return (measured) => apiOf(measured, token).sites[":site"].$delete({ param: { site: siteId(1) }, query: {} });
    },
    status: 200,
    budget: { queries: 3, reads: 0, writes: 0 },
  },
  {
    group,
    name: "delete a site for good, 1,001 files",
    route: "DELETE /api/sites/:site",
    // A removal lists a page of 1,000 files and deletes it, 15 pages at the most, and leaves the rest to the scheduled run. Seeded with two pages: the queries are the same for any count, and each page more is one listing more.
    arrange: async (stage) => {
      await siteWithFiles(stage, 1001);
      const token = await adminToken(stage);

      return (measured) => apiOf(measured, token).sites[":site"].$delete({ param: { site: siteId(1) }, query: { forever: "true" } });
    },
    status: 200,
    budget: { queries: 6, reads: 0, writes: 2, deletes: 2 },
  },
  {
    group,
    name: "restore a site from the trash",
    route: "POST /api/sites/:site/restore",
    // Worst: the trash holds the site and the install is asked whether it has room for it again.
    arrange: async (stage) => {
      await manySites(stage, 1, { versions: KEPT, trashed: true });
      const token = await adminToken(stage);

      return (measured) => apiOf(measured, token).sites[":site"].restore.$post({ param: { site: siteId(1) }, query: {} });
    },
    status: 200,
    budget: { queries: 3, reads: 0, writes: 0 },
  },
  {
    group,
    name: "backup: the settings",
    route: "GET /api/export/settings",
    // One row, whatever it holds.
    arrange: async (stage) => {
      const token = await adminToken(stage);

      return (measured) => apiOf(measured, token).export.settings.$get({ query: {} });
    },
    status: 200,
    budget: { queries: 2, reads: 0, writes: 0 },
  },
  {
    group,
    name: "backup: a page of sites, every version",
    route: "GET /api/export/sites",
    // Worst: a full page of 100 with another behind it, every version of every site asked for.
    arrange: async (stage) => {
      await manySites(stage, LARGEST_PAGE + 1, { versions: KEPT });
      const token = await adminToken(stage);

      return (measured) => apiOf(measured, token).export.sites.$get({ query: { limit: String(LARGEST_PAGE), all_versions: "true" } });
    },
    status: 200,
    budget: { queries: 2, read: 505, reads: 0, writes: 0 },
  },
  {
    group,
    name: "backup: one site, every version",
    route: "GET /api/export/sites/:site",
    // Worst: every version the site keeps is asked for.
    arrange: async (stage) => {
      await manySites(stage, 1, { versions: KEPT });
      const token = await adminToken(stage);

      return (measured) => apiOf(measured, token).export.sites[":site"].$get({ param: { site: siteId(1) }, query: { all_versions: "true" } });
    },
    status: 200,
    budget: { queries: 2, reads: 0, writes: 0 },
  },
  {
    group,
    name: "backup: a page of a version's files",
    route: "GET /api/export/sites/:site/files",
    // Worst: the largest page, 1,000 files, of a version that holds more. One listing a call, counted against the day.
    arrange: async (stage) => {
      await siteWithFiles(stage, 1001);
      const token = await adminToken(stage);

      return (measured) => apiOf(measured, token).export.sites[":site"].files.$get({ param: { site: siteId(1) }, query: { version: "1" } });
    },
    status: 200,
    budget: { queries: 3, reads: 0, writes: 1 },
  },
  {
    group,
    name: "backup: one file",
    route: "GET /api/export/sites/:site/file",
    // One read of the bucket, whatever the file's size: its bytes pass through.
    arrange: async (stage) => {
      await siteWithFiles(stage, 1);
      const token = await adminToken(stage);

      return (measured) => apiOf(measured, token).export.sites[":site"].file.$get({ param: { site: siteId(1) }, query: { version: "1", path: "index.html" } });
    },
    status: 200,
    budget: { queries: 2, reads: 1, writes: 0 },
  },
  {
    group,
    name: "restore a backup's settings, the logins too",
    route: "POST /api/import/settings",
    // Worst: every setting is sent and the logins are taken too, so every one is written.
    arrange: async (stage) => {
      const token = await adminToken(stage);
      const kept = await done<{ format: number; settings: Record<string, string> }>(await apiOf(unmeasured(stage), token).export.settings.$get({ query: {} }));

      return (measured) => apiOf(measured, token).import.settings.$post({ query: {}, json: { format: kept.format, settings: { ...kept.settings, trash_days: "9" }, logins: true } });
    },
    status: 200,
    budget: { queries: 3, reads: 0, writes: 0 },
  },
  {
    group,
    name: "read the settings",
    route: "GET /api/config",
    // One row, whatever it holds.
    arrange: async (stage) => {
      const token = await adminToken(stage);

      return (measured) => apiOf(measured, token).config.$get({ query: {} });
    },
    status: 200,
    budget: { queries: 2, reads: 0, writes: 0 },
  },
  {
    group,
    name: "change the settings",
    route: "PATCH /api/config",
    // Worst: a change that the stored settings must be read for and written with an audit entry.
    arrange: async (stage) => {
      const token = await adminToken(stage);

      return (measured) => apiOf(measured, token).config.$patch({ query: {}, json: { trash_days: 9, versions_kept: 5 } });
    },
    status: 200,
    budget: { queries: 2, reads: 0, writes: 0 },
  },
  {
    group,
    name: "sign everyone out",
    route: "DELETE /api/sessions",
    // A new signing key and one audit entry.
    arrange: async (stage) => {
      const token = await adminToken(stage);

      return (measured) => apiOf(measured, token).sessions.$delete({ query: {} });
    },
    status: 200,
    budget: { queries: 2, reads: 0, writes: 0 },
  },
  {
    group,
    name: "read the log, narrowed to a name no entry holds",
    route: "GET /api/audit",
    // Worst: a page narrowed to a name no entry holds, so the 5,000 newest entries of a longer log are looked through and none is found.
    arrange: async (stage) => {
      await manyEntries(stage, 6000, 10);
      const token = await adminToken(stage);

      return (measured) => apiOf(measured, token).audit.$get({ query: { limit: String(LARGEST_PAGE), site: "nowhere" } });
    },
    status: 200,
    budget: { queries: 2, read: 5008, reads: 0, writes: 0 },
  },
  {
    group,
    name: "read the domain's last check",
    route: "GET /api/domain",
    // Worst: a check was kept, so its pieces are read.
    arrange: async (stage) => {
      await sql(`INSERT INTO domain_check (id, ran_at, ran_by, run, pieces) VALUES (1, ?1, ?2, 'check', '[]')`, stage.w.clock.now, OWNER);
      const token = await adminToken(stage);

      return (measured) => apiOf(measured, token).domain.$get({ query: {} });
    },
    status: 200,
    budget: { queries: 2, reads: 0, writes: 0 },
  },
  {
    group,
    name: "read what went wrong in the last week",
    route: "GET /api/problems",
    // Worst: every kind was noted on each of the 7 days read.
    arrange: async (stage) => {
      await manyProblems(stage, 7);
      const token = await adminToken(stage);

      return (measured) => apiOf(measured, token).problems.$get({ query: {} });
    },
    status: 200,
    budget: { queries: 2, read: 71, reads: 0, writes: 0 },
  },
  {
    group,
    name: "start an update",
    route: "POST /api/update",
    // Worst: an address is saved and a newer release is known, so the build is started and the start written to the log.
    arrange: async (stage) => {
      await knownUpdate(stage);
      stage.outside.rebuild = async () => new Response(null, { status: 204 });
      const token = await adminToken(stage);

      return (measured) => apiOf(measured, token).update.$post({ query: {} });
    },
    status: 200,
    budget: { queries: 5, reads: 0, writes: 0 },
  },
  {
    group,
    name: "read whether a rebuild address is saved",
    route: "GET /api/update/address",
    // Worst: one is saved.
    arrange: async (stage) => {
      await knownUpdate(stage);
      const token = await adminToken(stage);

      return (measured) => apiOf(measured, token).update.address.$get({ query: {} });
    },
    status: 200,
    budget: { queries: 2, reads: 0, writes: 0 },
  },
  {
    group,
    name: "save a rebuild address",
    route: "PUT /api/update/address",
    // Worst: another address is saved already, which the new one replaces.
    arrange: async (stage) => {
      await knownUpdate(stage);
      const token = await adminToken(stage);

      return (measured) => apiOf(measured, token).update.address.$put({ query: {}, json: { address: `${HOOK.slice(0, -1)}1` } });
    },
    status: 200,
    budget: { queries: 2, reads: 0, writes: 0 },
  },
  {
    group,
    name: "remove the rebuild address",
    route: "DELETE /api/update/address",
    // Worst: one is saved, so it is removed and the removal written to the log.
    arrange: async (stage) => {
      await knownUpdate(stage);
      const token = await adminToken(stage);

      return (measured) => apiOf(measured, token).update.address.$delete({ query: {} });
    },
    status: 200,
    budget: { queries: 2, reads: 0, writes: 0 },
  },
  {
    group,
    name: "a request with no token",
    // The door: a request that proves nothing reads nothing.
    arrange: async () => (measured) => get(measured, `${ADMIN}/api/sites`),
    status: 401,
    budget: { queries: 0, reads: 0, writes: 0 },
  },
];
