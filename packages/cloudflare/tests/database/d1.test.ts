import { reset } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, test } from "vitest";

import { beginPublish } from "@poplin/core/src/actions/begin-publish";
import { beginLogin, redeemLogin } from "@poplin/core/src/actions/computer-logins";
import { finishPublish } from "@poplin/core/src/actions/finish-publish";
import { publishSite } from "@poplin/core/src/actions/publish";
import type { Install } from "@poplin/core/src/actions/records";
import { uploadFile } from "@poplin/core/src/actions/upload-file";
import type { Login } from "@poplin/core/src/auth/logins";
import type { Actor } from "@poplin/core/src/auth/scopes";
import { mintToken, type TokenId } from "@poplin/core/src/auth/tokens";
import { openDatabase } from "@poplin/core/src/database/open";
import { SqlDatabase } from "@poplin/core/src/database/sql-database";
import { PROBLEM_KINDS } from "@poplin/core/src/records/problem";
import { defaultSettings } from "@poplin/core/src/records/settings";
import { MemoryStore } from "@poplin/core/src/storage/memory";
import { meterStore } from "@poplin/core/src/storage/metered";
import type { PublicName, SiteName } from "@poplin/core/src/names/names";
import type { Site, SiteFolder } from "@poplin/core/src/records/site";
import type { UploadId } from "@poplin/core/src/records/upload";
import { dayOf } from "@poplin/core/src/records/views";
import type { SiteId } from "@poplin/core/src/sites/ids";
import { describeDatabase } from "@poplin/core/tests/database/support/database-contract";
import { BY_ADA, begunFiles, begunSite, begunVersion, draft, numberedFiles, pendingLogin, publish, storedBack } from "@poplin/core/tests/database/support/database-fixtures";
import { AUDIT_WINDOW } from "@poplin/core/src/database/database";
import { describeSqlDriver, LONG_LOG, sqlDatabaseOver } from "@poplin/core/tests/database/support/sql-driver-contract";

import type { Bindings } from "../../src/worker/bindings";
import { D1Driver } from "../../src/database/d1";
import { runSweep } from "../../src/worker/sweep";

/** The bindings of wrangler.jsonc, simulated. */
const BINDINGS: Bindings = env;

/** The moment every fixture is made at. */
const NOW = 1_700_000_000_000;

/** The SHA-256 of the four bytes `page` in base64, as `openssl dgst -sha256 -binary | base64` gives it: what a file that holds them declares. */
const PAGE_SHA256 = "NmAxWprz3yVdjxmrB35Hl4IrQUiKDioEvGr3EhPCMnQ=";

/** A midnight UTC after it, where an hour of the clock and a day both begin. */
const MIDNIGHT = 1_700_006_400_000;

/** How many sites the log that is searched by a site is about. */
const SEARCHED_SITES = 60;

/** How many new links each of the first sites of that log got; the sites after them got none. */
const NEW_LINKS = [3, 1, 1];

/** Writes a window of entries, each about one of the sites there are, under a name none of them has. */
const LOG_ABOUT_SITES = `
INSERT INTO audit (at, actor, action, site_id, site_name, detail)
WITH RECURSIVE entry(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM entry WHERE n < ${AUDIT_WINDOW})
SELECT 1700000000000, '00000000000000aa', 'details', site.id, 'old', '{}'
FROM entry JOIN (SELECT id, row_number() OVER (ORDER BY created_at) - 1 AS place FROM sites) AS site ON site.place = n % ${SEARCHED_SITES}`;

/** A publisher's token, which begins the fixture publishes. */
const PUBLISHER: Actor = { scope: "publisher", holder: "00000000000000aa" as TokenId };

/** The waiting logins `beginLogin` keeps of all visitors together. */
const PLACES = 50;

/** The visitors that hold the places between them, three logins each. */
const VISITORS = 17;

/** The sites the listing is read from. */
const LISTED = 30;

/** The day the fixture requests are counted on. */
const DAY = "2026-11-13";

/** The sites the walk starts with. */
const SITES = 12;

/** The admin who decides the fixture login. */
const ADMIN = "ada@example.com" as Login;

/** An id no site has. */
const NOBODY = "zzzzzzzzzzzz" as SiteId;

/** A room no fixture fills. */
const ROOM = { perVisitor: 100, all: 100 };

/** The rows each call of the walk read and wrote, by the call's name. */
const ROWS: Readonly<Record<string, readonly [read: number, written: number]>> = {
  "initSettings": [4, 2],
  "readSettings": [1, 0],
  "changeSettings": [2, 2],
  "changeSettings, the same": [2, 0],
  "initSettings, already set": [3, 0],
  "addLogin": [5, 3],
  "addLogin, already one": [5, 0],
  "removeLogin": [8, 3],
  "removeLogin, not one": [5, 0],
  "removeLogin, the last": [5, 0],
  "changeSettings, a login more": [13, 3],
  "changeSettings, another first login": [4, 3],
  "ensureVisitorKey, the first": [2, 1],
  "ensureVisitorKey, kept": [3, 0],
  "readVisitorKey": [1, 0],
  "readSettingsAndKey": [2, 0],
  "rotateVisitorKey": [0, 2],
  "keepUpdateAddress": [0, 2],
  "readUpdateAddress": [1, 0],
  "forgetUpdateAddress": [1, 2],
  "forgetUpdateAddress, none kept": [0, 0],
  "keepUpdateCheck": [2, 1],
  "readUpdateCheck": [1, 0],
  "keepAutoStart": [1, 1],
  "keepDomainCheck": [1, 2],
  "keepDomainCheck, 200 pieces over the run before": [1, 2],
  "readDomainCheck": [1, 0],
  "claimUsers": [3, 1],
  "settleUsers, the stored logins carried": [4, 1],
  "settleUsers, a try whose outcome is unknown": [3, 1],
  "claimRules": [3, 1],
  "settleRules, the stored settings carried": [3, 1],
  "claimRules, nothing waits": [3, 0],
  "readFrame": [4, 0],
  "noteProblem, the day's first": [1, 1],
  "noteProblem, the same hour": [1, 0],
  "noteProblem, a later hour": [1, 1],
  "noteProblem, once a day": [1, 1],
  "noteProblem, once a day and noted": [1, 0],
  "listProblems, 7 days of 12 kinds": [84, 0],
  "sweepRunOut, 14 problems past the days kept": [25, 14],
  "keepSweepPlace": [1, 1],
  "readSweepPlace": [1, 0],
  "keepSweepPlace, forgotten": [0, 1],
  "createSite": [9, 11],
  "createSite, public": [10, 11],
  "createSite, name taken": [3, 0],
  "getSite": [3, 0],
  "getSite, none": [0, 0],
  "getSiteWithSettings": [4, 0],
  "getSiteWithSettings, none": [1, 0],
  "getShownSite, with the views and the publishers": [15, 0],
  "getSiteNames": [10, 0],
  "getSiteByPublicName": [2, 0],
  "getSiteByFolder": [3, 0],
  "findServed, by id": [2, 0],
  "findServed, by public name": [2, 0],
  "findServed, a site that keeps two versions": [2, 0],
  "findServedWith, the day's counts": [2, 0],
  "findServedWith, the day's counts, the settings and the key": [4, 0],
  "readTotals": [1, 0],
  "exportSites": [18, 0],
  "exportSites, after": [18, 0],
  "giveNewId": [737, 8],
  "getLaterSites": [9, 0],
  "reserveVersion": [5, 1],
  "addVersion": [22, 4],
  "addVersion, one dropped": [27, 6],
  "setLiveVersion, a number": [8, 2],
  "setLiveVersion, the same": [6, 0],
  "setLiveVersion, previous": [9, 2],
  "trashSite": [6, 6],
  "trashSite, in the trash": [5, 0],
  "restoreSite": [6, 5],
  "deleteSite": [13, 6],
  "listLeftovers": [1, 0],
  "storedBack: addUpload, importUploadAsSite, abandonUpload, removeUpload": [27, 21],
  "forgetLeftover": [1, 1],
  "addUpload, a new site": [8, 5],
  "getUpload": [1, 0],
  "getUploadFile": [1, 0],
  "getUploadFile, no such file": [1, 0],
  "getUploadFiles, two files and one that is not there": [1, 0],
  "listUploads": [1, 0],
  "publishUploadAsSite": [14, 13],
  "publishUploadAsSite, not pending": [5, 0],
  "setUploadDropped": [1, 1],
  "removeUpload": [1, 1],
  "reserveVersion and addUpload, a version": [14, 6],
  "publishUploadAsVersion, with access and details": [62, 13],
  "publishUploadAsVersion, plain": [43, 8],
  "addUpload, 500 files": [8, 5],
  "abandonUpload": [2, 2],
  "addToken": [1, 4],
  "getToken": [1, 0],
  "listTokens": [2, 0],
  "getTokenNames, 1 of 2": [1, 0],
  "getTokenNames, 1 of 2 among 250 ids": [251, 0],
  "revokeToken": [3, 3],
  "listTokenStates": [3, 0],
  "addComputerLogin": [6, 3],
  "getComputerLogin": [1, 0],
  "findComputerLogin": [1, 0],
  "listWaitingComputerLogins": [4, 0],
  "decideComputerLogin": [4, 3],
  "redeemComputerLogin": [4, 5],
  "sweepRunOut": [11, 1],
  "appendAudit, a login": [0, 2],
  "hasLoggedIn, nobody yet": [1, 0],
  "hasLoggedIn": [1, 0],
  "noteLogin, a new login": [2, 2],
  "noteLogin, known": [2, 0],
  "addRequests": [2, 2],
  "addRequests, again": [2, 2],
  "readRequests": [2, 0],
  "readRequests, all sites": [1, 0],
  "readViews": [42, 0],
  "readDailyViews, 30 days": [188, 0],
  "readDailyViews, a year": [2198, 0],
  "readDailyViews, a year, fifty sites": [18668, 0],
  "listSites": [18, 0],
  "listShownSites, with the views and the publishers": [73, 0],
  "listShownSites, with the views": [61, 0],
  "listSites, the next page": [18, 0],
  "listSites, by name, one holder, a text, an access": [38, 0],
  "listSites, by access": [51, 0],
  "changeAccess": [6, 3],
  "changeAccess, the same": [5, 0],
  "changeAccess, name taken": [6, 0],
  "changeAccessAndDetails": [8, 2],
  "changeAccessAndDetails, the same": [8, 0],
  "publishUploadAsSite, a copy": [15, 14],
  "changeDetails": [5, 2],
  "changeDetails, the same": [5, 0],
  "listAudit": [20, 0],
  "searchAudit, one kind, the sites named with a text": [65, 0],
  "listAudit, the oldest first": [20, 0],
  "searchAudit, the oldest first, the next page of one kind": [27, 0],
  "listAudit, a reading for a file": [45, 0],
  "listNamedAudit": [32, 0],
  "searchNamedAudit, one kind, the sites named with a text": [71, 0],
  "listNamedAudit, a reading for a file": [77, 0],
  "endOfAuditPart, of twenty entries": [21, 0],
  "countAudit": [2, 0],
  "countAudit, one kind, the sites named with a text": [64, 0],
  "countAudit, no further back than five entries, and where the log starts": [6, 0],
  "no site: getSiteByPublicName": [0, 0],
  "no site: giveNewId": [2, 0],
  "no site: reserveVersion": [0, 0],
  "no site: addVersion": [2, 0],
  "no site: setLiveVersion": [0, 0],
  "no site: trashSite": [0, 0],
  "no site: restoreSite": [0, 0],
  "no site: deleteSite": [0, 0],
  "in the trash: findServed": [1, 0],
  "in the trash: giveNewId": [6, 0],
  "in the trash: reserveVersion": [5, 0],
  "in the trash: changeAccess": [5, 0],
  "in the trash: changeDetails": [5, 0],
  "refused: restoreSite, a live site": [6, 0],
  "refused: addVersion, a number not set aside": [17, 0],
  "refused: setLiveVersion, no such version": [6, 0],
  "refused: publishUploadAsVersion, not pending": [19, 0],
  "refused: removeUpload, none": [0, 0],
  "refused: abandonUpload, not pending": [1, 0],
  "refused: addUpload, its holder's room is full": [4, 0],
  "refused: addToken, the id is taken": [2, 0],
  "refused: revokeToken, none": [3, 0],
  "refused: decideComputerLogin, none waits": [0, 0],
  "refused: redeemComputerLogin, none allowed": [1, 0],
  "readStorageWrites": [2, 0],
  "takeStorageWrite": [3, 1],
  "takeStorageWrite, again": [3, 1],
  "addStorageWrites": [0, 1],
};

/** The rows the batches of a database read and wrote, as the provider counts them toward a day's allowance. */
interface RowCounts {
  read: number;
  written: number;
}

/** Run one statement straight on the database, outside every count of rows. */
async function straight(sql: string): Promise<void> {
  await BINDINGS.DB.prepare(sql).run();
}

async function emptyDatabase(): Promise<D1Driver> {
  await reset();

  return new D1Driver(BINDINGS.DB);
}

/** An empty database whose every batch adds the rows it read and wrote to `rows`. */
async function meteredDatabase(): Promise<{ readonly driver: D1Driver; readonly rows: RowCounts }> {
  await reset();
  const rows: RowCounts = { read: 0, written: 0 };

  const metered: Pick<D1Database, "prepare" | "batch"> = {
    prepare: (sql) => BINDINGS.DB.prepare(sql),
    async batch<Row = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<Row>[]> {
      const results = await BINDINGS.DB.batch<Row>(statements);

      for (const { meta } of results) {
        rows.read += meta.rows_read;
        rows.written += meta.rows_written;
      }

      return results;
    },
  };

  return { driver: new D1Driver(metered as D1Database), rows };
}

/** An install over an empty database whose every batch adds the rows it read and wrote to `rows`. */
async function meteredInstall(): Promise<{ readonly install: Install; readonly rows: RowCounts }> {
  const { driver, rows } = await meteredDatabase();
  const opened = await openDatabase(driver, NOW);
  if (opened.kind !== "open") throw new Error(`the database did not open: ${opened.kind}`);

  const install: Install = {
    database: opened.database,
    store: new MemoryStore(),
    now: () => NOW,
    addressOf: (label) => `https://${label}.example.com`,
    publicAddressOf: (name) => `https://${name}.example.com`,
    reservedNames: new Set(),
  };

  return { install, rows };
}

/** Run one step of a publish as its route does: the listings it makes are counted against the day, and the count is written when the step ends. */
async function asRoute<Answer>(install: Install, step: (counted: Install) => Promise<Answer>): Promise<Answer> {
  const meter = meterStore(install.store, { database: install.database, now: install.now });

  try {
    return await step({ ...install, store: meter.store });
  } finally {
    await meter.settle();
  }
}

/** Publish a new site of `files` pages of four bytes each through the three steps, each as its route runs it; answers the rows the whole of it read and wrote. */
async function publishCost(files: number): Promise<RowCounts> {
  const { install, rows } = await meteredInstall();
  await install.database.initSettings(defaultSettings({ installer: "ada@example.com" as Login }), { by: PUBLISHER.holder, at: NOW });
  const paths = ["index.html", ...Array.from(Array(files - 1).keys(), (index) => `pages/${index}.html`)];
  rows.read = 0;
  rows.written = 0;

  const begun = await asRoute(install, (counted) => beginPublish(counted, PUBLISHER, { name: "report", files: paths.map((path) => ({ path, size: 4, content_type: "text/html", sha256: PAGE_SHA256 })) }));
  if (!begun.ok) throw new Error(`the publish was refused: ${begun.code}`);

  for (const path of paths) await asRoute(install, (counted) => uploadFile(counted, PUBLISHER, { upload: begun.upload.id, path, body: new Blob(["page"]).stream() }));

  const finished = await asRoute(install, (counted) => finishPublish(counted, PUBLISHER, begun.upload.id));
  if (!finished.ok) throw new Error(`the publish was not finished: ${finished.code}`);

  return { ...rows };
}

describeDatabase("D1", sqlDatabaseOver(emptyDatabase));
describeSqlDriver("D1", emptyDatabase);

describe("D1: the rows a publish costs of a day's allowance", () => {
  // Drift: the provider counts every entry of a JSON value a statement walks as a row read, and a publish asks for a file once per file; a lookup that walked the manifest read as many rows as the publish had files, squared.
  test.each([3, 5000])("one file of an upload of %d files is read as one row, and so are a hundred of its files in one call, and its whole manifest", async (files) => {
    const { driver, rows } = await meteredDatabase();
    const opened = await openDatabase(driver, NOW);
    if (opened.kind !== "open") throw new Error(`the database did not open: ${opened.kind}`);

    const upload = await begunFiles(opened.database, numberedFiles(files));
    rows.read = 0;
    rows.written = 0;
    const one = await opened.database.getUploadFile(upload, "page-2.html");
    const lookup = { ...rows };
    const hundred = await opened.database.getUploadFiles(upload, numberedFiles(Math.min(files, 100)).map((file) => file.path));
    const tickets = { ...rows };
    const whole = await opened.database.getUpload(upload);

    expect([one?.file?.size, hundred?.files.filter((file) => file !== undefined).length, whole?.manifest.length]).toEqual([2, Math.min(files, 100), files]);
    expect([lookup, tickets, rows]).toEqual([{ read: 1, written: 0 }, { read: 2, written: 0 }, { read: 3, written: 0 }]);
  });

  // Drift: the files of a day are counted so that the bucket's free month is not passed. A count kept a row per file, or one that read the days before, would spend the database's day to guard the bucket's month.
  test.each([3, 5000])("recording an upload of %d files reads 15 rows and writes 5, whatever it holds: two read and one written are the day's count", async (files) => {
    const { driver, rows } = await meteredDatabase();
    const opened = await openDatabase(driver, NOW);
    if (opened.kind !== "open") throw new Error(`the database did not open: ${opened.kind}`);

    await begunFiles(opened.database, numberedFiles(3));
    rows.read = 0;
    rows.written = 0;
    await begunFiles(opened.database, numberedFiles(files));

    expect(rows).toEqual({ read: 15, written: 5 });
  });

  // Drift: a day allows 5,000,000 rows read and 100,000 written, and every query fails once either is spent; a publish whose cost grew faster than its files would spend a day in one go.
  test.each([50, 200])("a whole publish of %d files reads one row a file and 27 more, and writes 19: four read and one written are the count of the listing that checks its files", async (files) => {
    expect(await publishCost(files)).toEqual({ read: files + 27, written: 19 });
  });
});

describe("D1: the rows a listing, a change to a site, and a page of the audit log cost of a day's allowance", () => {
  // Drift: these statements are built from the declared schema, and the provider counts rows by how the engine runs a statement, not by what it answers. A statement built another way can answer the same and read more.
  test("a page of ten sites reads its eleven sites and their versions; a change reads its site, writes it and its audit entry; a page of the log reads its entries", async () => {
    const { driver, rows } = await meteredDatabase();
    const minted = { count: 0 };
    const mintId = (): SiteId => {
      minted.count += 1;

      return `site${String(minted.count).padStart(8, "0")}` as SiteId;
    };
    const opened = await openDatabase(driver, NOW);
    if (opened.kind !== "open") throw new Error(`the database did not open: ${opened.kind}`);

    const database = new SqlDatabase(driver, mintId);
    const ids: SiteId[] = [];

    for (let index = 0; index < LISTED; index += 1) {
      const site = { ...draft(`site-${index}` as SiteName), folder: `fold${String(index).padStart(12, "0")}` as SiteFolder };
      const made = await database.createSite(site, { ...BY_ADA, at: NOW + index });
      if (made.kind === "done") ids.push(made.site.id);
    }

    const [first, second] = ids as [SiteId, SiteId];
    const blog = { access: "public", public_name: "blog" as PublicName } as const;
    const cost = async (run: () => Promise<unknown>): Promise<readonly [read: number, written: number]> => {
      rows.read = 0;
      rows.written = 0;
      await run();

      return [rows.read, rows.written];
    };
    const page = await database.listSites({ trash: false, limit: 10 });
    const named = await database.listSites({ trash: false, limit: 10, sort: "name" });
    const titled = await database.listSites({ trash: false, limit: 10, sort: "title" });

    expect({
      "the first page": await cost(() => database.listSites({ trash: false, limit: 10 })),
      "the page after it": await cost(() => database.listSites({ trash: false, limit: 10, ...(page.next === undefined ? {} : { after: page.next }) })),
      "a page of one holder's private sites, by name": await cost(() => database.listSites({ trash: false, limit: 10, owner: BY_ADA.by, named: "site-1", access: "private" })),
      "an access that changes": await cost(() => database.changeAccess(first, blog, BY_ADA)),
      "the same access again": await cost(() => database.changeAccess(first, blog, BY_ADA)),
      "a public name that is taken": await cost(() => database.changeAccess(second, blog, BY_ADA)),
      "a detail that changes": await cost(() => database.changeDetails(second, { title: "Report" }, BY_ADA)),
      "the same detail again": await cost(() => database.changeDetails(second, { title: "Report" }, BY_ADA)),
      "a page of twenty entries": await cost(() => database.listAudit({ limit: 20 })),
      "a page of the entries of one kind for one site": await cost(() => database.searchAudit({ limit: 20, actions: ["create"], site: "site-1" })),
      "a page by name": await cost(() => database.listSites({ trash: false, limit: 10, sort: "name" })),
      "the page by name after it": await cost(() => database.listSites({ trash: false, limit: 10, sort: "name", ...(named.next === undefined ? {} : { after: named.next }) })),
      "a page by title": await cost(() => database.listSites({ trash: false, limit: 10, sort: "title" })),
      "the page by title after it": await cost(() => database.listSites({ trash: false, limit: 10, sort: "title", ...(titled.next === undefined ? {} : { after: titled.next }) })),
      "a page by access, the most open first": await cost(() => database.listSites({ trash: false, limit: 10, sort: "access", dir: "desc" })),
      "a page of the sites that never expire": await cost(() => database.listSites({ trash: false, limit: 10, expires: "never" })),
      "a page of the trash": await cost(() => database.listSites({ trash: true, limit: 10 })),
    }).toEqual({
      "the first page": [32, 0],
      "the page after it": [34, 0],
      "a page of one holder's private sites, by name": [51, 0],
      "an access that changes": [6, 3],
      "the same access again": [5, 0],
      "a public name that is taken": [6, 0],
      "a detail that changes": [5, 2],
      "the same detail again": [5, 0],
      "a page of twenty entries": [20, 0],
      "a page of the entries of one kind for one site": [67, 0],
      "a page by name": [104, 0],
      "the page by name after it": [94, 0],
      "a page by title": [104, 0],
      "the page by title after it": [94, 0],
      "a page by access, the most open first": [103, 0],
      "a page of the sites that never expire": [32, 0],
      "a page of the trash": [1, 0],
    });

    // The trash is ordered by when a site went there, which its index holds: a page of it reads its own sites alone, and what a screen shows beside them is read for those and no other.
    for (const id of ids.slice(0, 8)) await database.trashSite(id, BY_ADA);
    const trash = { trash: true, limit: 3 } as const;

    expect({
      "a page of three of the eight in the trash": await cost(() => database.listSites(trash)),
      "the same page as a screen lists it, with the settings, the views, and the publishers": await cost(() => database.listShownSites(trash, { day: DAY, publishers: true })),
    }).toEqual({
      "a page of three of the eight in the trash": [12, 0],
      "the same page as a screen lists it, with the settings, the views, and the publishers": [49, 0],
    });
  });
});

describe("D1: the rows a search of the audit log by a site costs of a day's allowance", () => {
  // Drift: a text finds a site by the title it has now, which the log does not hold, so the sites are read. Read once an entry, a search would cost the window several times over, each row charged.
  // An id finds its site by a key: read by a look through the sites, "Only this site" would cost what a text costs.
  test("a window of entries about sixty sites, three of them given a new link, one of those three times: a search by a text reads the window, each site once, and each earlier id once; one by an id reads the window and that site", async () => {
    const { driver, rows } = await meteredDatabase();
    const opened = await openDatabase(driver, NOW);
    if (opened.kind !== "open") throw new Error(`the database did not open: ${opened.kind}`);

    const database = new SqlDatabase(driver);
    const first: SiteId[] = [];
    for (let index = 0; index < SEARCHED_SITES; index += 1) {
      const site = { ...draft(`site-${index}` as SiteName), title: `Title ${index}`, folder: `fold${String(index).padStart(12, "0")}` as SiteFolder };
      const made = await database.createSite(site, { ...BY_ADA, at: NOW + index });
      if (made.kind !== "done") throw new Error(`no site was made: ${made.kind}`);

      first.push(made.site.id);
      let id = made.site.id;
      for (let link = 0; link < (NEW_LINKS[index] ?? 0); link += 1) {
        const given = await database.giveNewId(id, BY_ADA);
        if (given.kind === "done") id = given.site.id;
      }
    }
    await driver.batch([{ sql: LOG_ABOUT_SITES, params: [] }]);
    const cost = async (run: () => Promise<unknown>): Promise<number> => {
      rows.read = 0;
      await run();

      return rows.read;
    };

    expect({
      "a page for a title no site has": await cost(() => database.searchAudit({ limit: 51, site: "Nowhere" })),
      "a page for a title one site has": await cost(() => database.searchAudit({ limit: 51, site: "title 59" })),
      "a count for a title no site has": await cost(() => database.countAudit({ most: AUDIT_WINDOW, site: "Nowhere" })),
      "a count for a title every site has": await cost(() => database.countAudit({ most: AUDIT_WINDOW, site: "TITLE" })),
      "a page of the site an id names": await cost(() => database.searchAudit({ limit: 51, of: first[59] })),
      "a count of the site an id names": await cost(() => database.countAudit({ most: AUDIT_WINDOW, of: first[59] })),
      "a count of the site that gave an id up, after one new link": await cost(() => database.countAudit({ most: AUDIT_WINDOW, of: first[1] })),
      "a count of the site that gave an id up, after three new links": await cost(() => database.countAudit({ most: AUDIT_WINDOW, of: first[0] })),
      "a count of an id no site has": await cost(() => database.countAudit({ most: AUDIT_WINDOW, of: NOBODY })),
    }).toEqual({
      // The window, the sites once, and a few rows more: where the log starts and ends, and the five earlier ids, each with its site.
      "a page for a title no site has": AUDIT_WINDOW + SEARCHED_SITES + 15,
      // A page is full at its 51st entry and one more: this site's entries are one in sixty.
      "a page for a title one site has": 3096,
      "a count for a title no site has": AUDIT_WINDOW + SEARCHED_SITES + 13,
      "a count for a title every site has": AUDIT_WINDOW + SEARCHED_SITES + 3,
      // An id names its site by a key, never by a look through the sites.
      "a page of the site an id names": 3029,
      // The window and where the log starts and ends, then the site: three rows to find it by its id and its folder, and one more for each id it gave up.
      "a count of the site an id names": AUDIT_WINDOW + 3 + 3,
      "a count of the site that gave an id up, after one new link": AUDIT_WINDOW + 3 + 5,
      "a count of the site that gave an id up, after three new links": AUDIT_WINDOW + 3 + 7,
      "a count of an id no site has": AUDIT_WINDOW + 3,
    });
  });
});

describe("D1: the rows a narrowed page of a long audit log costs of a day's allowance", () => {
  // Drift: a narrowing is a text inside a name, which no index serves, so the engine reads every entry it passes. A page that looked on until it was full would read the whole log for a rare site, each row charged.
  test("a log of five entries more than a window, and two about sites: a narrowed page reads its window and seven rows more, for where the log starts and ends and for a look at the sites, of which there are none, never the log", async () => {
    const { driver, rows } = await meteredDatabase();
    const opened = await openDatabase(driver, NOW);
    if (opened.kind !== "open") throw new Error(`the database did not open: ${opened.kind}`);

    const database = new SqlDatabase(driver);
    await driver.batch([{ sql: LONG_LOG, params: [] }]);
    const cost = async (run: () => Promise<unknown>): Promise<number> => {
      rows.read = 0;
      await run();

      return rows.read;
    };

    expect({
      "the newest page of a rare site": await cost(() => database.searchAudit({ limit: 51, site: "o" })),
      "the page that goes on from where it stopped": await cost(() => database.searchAudit({ limit: 51, site: "o", after: 8 })),
      "the oldest page of a rare site": await cost(() => database.searchAudit({ limit: 51, site: "o", dir: "asc" })),
      "a page that fills at once": await cost(() => database.searchAudit({ limit: 51, actions: ["login"] })),
      "a count under a narrowing": await cost(() => database.countAudit({ most: AUDIT_WINDOW, site: "o" })),
    }).toEqual({
      "the newest page of a rare site": AUDIT_WINDOW + 7,
      "the page that goes on from where it stopped": 11,
      "the oldest page of a rare site": AUDIT_WINDOW + 7,
      "a page that fills at once": 56,
      "a count under a narrowing": AUDIT_WINDOW + 5,
    });
  });
});

describe("D1: the rows the Activity line of a login costs of a day's allowance", () => {
  // Drift: the line is asked for by its email and its moment, which the index of the logins serves. Asked of the log, or of every login in it, each page a person opens after a login would read the logins of the install's whole life.
  test("with 3,000 logins in the log, 1,000 of them this email's: a login whose line stands reads 2 rows and writes none, a new login reads 2 and writes 2, and whether anybody ever logged in reads 1", async () => {
    const { driver, rows } = await meteredDatabase();
    const opened = await openDatabase(driver, NOW);
    if (opened.kind !== "open") throw new Error(`the database did not open: ${opened.kind}`);

    const database = new SqlDatabase(driver);
    const emails = "CASE n % 3 WHEN 0 THEN 'ada@example.com' WHEN 1 THEN 'bo@example.com' ELSE 'cy@example.com' END";
    await driver.batch([{ sql: `WITH RECURSIVE counted(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM counted WHERE n < 3000) INSERT INTO audit (at, actor, action, detail) SELECT ?1 + n, ${emails}, 'login', '{}' FROM counted`, params: [NOW] }]);
    const cost = async (run: () => Promise<unknown>): Promise<readonly [read: number, written: number]> => {
      rows.read = 0;
      rows.written = 0;
      await run();

      return [rows.read, rows.written];
    };

    expect({
      "a login whose line stands": await cost(() => database.noteLogin(ADMIN, { since: NOW + 2000, at: NOW + 4000 })),
      "a new login": await cost(() => database.noteLogin(ADMIN, { since: NOW + 4000, at: NOW + 4000 })),
      "the same login again": await cost(() => database.noteLogin(ADMIN, { since: NOW + 4000, at: NOW + 4001 })),
      "whether anybody ever logged in": await cost(() => database.hasLoggedIn()),
    }).toEqual({
      "a login whose line stands": [2, 0],
      "a new login": [2, 2],
      "the same login again": [2, 0],
      "whether anybody ever logged in": [1, 0],
    });
  });
});

describe("D1: the rows a computer's login costs of a day's allowance", () => {
  // Drift: anyone may begin a login, and a day allows 5,000,000 rows read and 100,000 written. The room once cost 2,705 rows read a login, and a terminal's question one row written.
  test("with the fifty places held, a new login reads 58 rows and writes 4, and a terminal's question reads 1 and writes none", async () => {
    const { install, rows } = await meteredInstall();
    const begin = async (visitor: number): Promise<string> => {
      const begun = await beginLogin(install, { scope: "publisher", computer: "laptop" }, `visitor-${visitor}`);
      if (!begun.ok) throw new Error(`the login was refused: ${begun.code}`);

      return begun.secret;
    };
    for (let place = 0; place < PLACES; place += 1) await begin(place % VISITORS);

    rows.read = 0;
    rows.written = 0;
    const secret = await begin(VISITORS);
    const begun = { ...rows };
    const asked = await redeemLogin(install, { secret });

    expect([asked, begun, rows]).toEqual([{ ok: true, state: "pending" }, { read: 58, written: 4 }, { read: 59, written: 4 }]);
  });
});

describe("D1: the rows a scheduled sweep costs of a day's allowance", () => {
  // Drift: the sweep runs 96 times a day, and a day allows 100,000 rows written. A run that wrote a row with nothing due would spend the allowance of an install nobody uses.
  // The one row a day is the answer to the day's question about a newer version, which the first run of the day asks.
  test("the day's first run writes the one row of the newest version; a later run writes none on an install that holds nothing, and none on one whose site, upload, and login are not due", async () => {
    const { install, rows } = await meteredInstall();
    const website = { asked: 0 };
    const latest = {
      fetch: async (): Promise<Response> => {
        website.asked += 1;

        return Response.json({ version: "0.2.0", released: "2026-12-01", notes: "https://example.com/changelog/", schema: 1 });
      },
    };
    const unbuilt = { accepts: () => false, fetch: () => Promise.reject(new Error("the test asked for a build")), counters: { takeMinute: async () => ({ ok: true as const }) } };
    const keyless = { holdsKey: () => false, push: async () => ({ ok: false as const, refusal: "no_key" as const }) };
    const running = { version: "0.1.0", rebuilding: unbuilt, follow: { where: "Cloudflare", ...keyless }, rules: keyless };
    await install.database.initSettings(defaultSettings({ installer: "ada@example.com" as Login }), { by: PUBLISHER.holder, at: NOW });
    rows.read = 0;
    rows.written = 0;
    await runSweep(install, latest, running);
    const first = { ...rows };

    rows.read = 0;
    rows.written = 0;
    await runSweep(install, latest, running);
    const idle = { ...rows };

    await publishSite(install, PUBLISHER, { name: "report", files: [{ path: "index.html", size: 4, contentType: "text/html", open: () => new Blob(["page"]).stream() }] });
    await beginPublish(install, PUBLISHER, { name: "notes", files: [{ path: "index.html", size: 4, content_type: "text/html", sha256: PAGE_SHA256 }] });
    await beginLogin(install, { scope: "publisher", computer: "laptop" }, "visitor-1");
    rows.read = 0;
    rows.written = 0;
    await runSweep(install, latest, running);

    expect([first, idle, rows, website.asked]).toEqual([
      { read: 20, written: 1 },
      { read: 18, written: 0 },
      { read: 18, written: 0 },
      1,
    ]);
  });

  // Drift: a day allows 100,000 rows written, and the provider counts every row a trim removes. A trim with no bound would spend the day on a long log in one run, and one that wrote with nothing left to remove would spend it on nothing.
  test("the end of a walk with a full trim due writes 125 rows, the 100 entries of the log and the 25 ended tokens it removes, and the one after the last of them writes none", async () => {
    const { install, rows } = await meteredInstall();
    const longAgo = NOW - 200 * 86_400_000;
    await straight(`INSERT INTO audit (at, actor, action, detail) WITH RECURSIVE entry(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM entry WHERE n < 100) SELECT ${longAgo}, 'ada@example.com', 'login', '{}' FROM entry`);
    const ended = `SELECT printf('%016x', n), 'h', 'publisher', '', ${longAgo}, ${longAgo} + n, 'ada@example.com' FROM token`;
    await straight(`INSERT INTO tokens (id, hash, scope, note, created_at, removed_at, removed_by) WITH RECURSIVE token(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM token WHERE n < 25) ${ended}`);
    await install.database.appendAudit({ action: "login", detail: {} }, { by: "ada@example.com" as Login, at: NOW });
    rows.read = 0;
    rows.written = 0;
    await install.database.sweepRunOut(NOW);
    const full = { ...rows };

    rows.read = 0;
    rows.written = 0;
    await install.database.sweepRunOut(NOW);

    expect([full, rows, await install.database.countAudit({ most: 1000 }), (await install.database.listTokenStates(NOW, 50)).ended]).toEqual([{ read: 709, written: 125 }, { read: 15, written: 0 }, { count: 1, whole: true }, []]);
  });
});

describe("D1: the rows a database costs to open", () => {
  // Drift: every instance opens the database when it starts, hundreds of times a day. A check that walked the schema to see whether the ledger is there read a row for every table, index, and trigger at each start.
  test("a database that is up to date is opened for the one row of its step; only one no step ran on is asked about its schema", async () => {
    const { driver, rows } = await meteredDatabase();
    const first = await openDatabase(driver, NOW);
    const made = { ...rows };
    rows.read = 0;
    rows.written = 0;

    const again = await openDatabase(driver, NOW);

    expect([first.kind, again.kind, again.kind === "open" ? again.applied : undefined, rows]).toEqual(["open", "open", [], { read: 1, written: 0 }]);
    expect(made.read).toBeGreaterThan(rows.read);
  });
});

describe("D1: the rows every operation of the database costs of a day's allowance", () => {
  // Drift: the provider counts rows by how the engine runs a statement, not by what it answers, and a day allows 5,000,000 read and 100,000 written.
  // A statement written another way can answer the same and cost more; nothing but this count shows it.
  test("one walk through the interface, each call metered, reads and writes the rows it did before", async () => {
    const { driver, rows } = await meteredDatabase();
    const opened = await openDatabase(driver, NOW);
    if (opened.kind !== "open") throw new Error(`the database did not open: ${opened.kind}`);

    const minted = { count: 0 };
    const database = new SqlDatabase(driver, () => {
      minted.count += 1;

      return `site${String(minted.count).padStart(8, "0")}` as SiteId;
    });
    const folder = (index: number): SiteFolder => `fold${String(index).padStart(12, "0")}` as SiteFolder;
    const site = (index: number): ReturnType<typeof draft> => ({ ...draft(`site-${index}` as SiteName), folder: folder(index) });
    const costs: Record<string, readonly [number, number]> = {};
    const cost = async <Answer>(name: string, run: () => Promise<Answer>): Promise<Answer> => {
      rows.read = 0;
      rows.written = 0;
      const answer = await run();
      costs[name] = [rows.read, rows.written];

      return answer;
    };
    const done = <Answer extends { readonly kind: string }>(answer: Answer): Extract<Answer, { kind: "done" }> => {
      if (answer.kind !== "done") throw new Error(`the walk was refused: ${answer.kind}`);

      return answer as Extract<Answer, { kind: "done" }>;
    };

    await cost("initSettings", () => database.initSettings(defaultSettings({ installer: ADMIN }), BY_ADA));
    await cost("readSettings", () => database.readSettings());
    await cost("changeSettings", () => database.changeSettings({ versions_kept: 4 }, BY_ADA));
    await cost("changeSettings, the same", () => database.changeSettings({ versions_kept: 4 }, BY_ADA));
    await cost("initSettings, already set", () => database.initSettings(defaultSettings({ installer: ADMIN }), BY_ADA));
    await cost("ensureVisitorKey, the first", () => database.ensureVisitorKey(new Uint8Array(32).fill(1), NOW));
    await cost("ensureVisitorKey, kept", () => database.ensureVisitorKey(new Uint8Array(32).fill(2), NOW));
    await cost("readVisitorKey", () => database.readVisitorKey());
    await cost("readSettingsAndKey", () => database.readSettingsAndKey());
    await cost("rotateVisitorKey", () => database.rotateVisitorKey(new Uint8Array(32).fill(3), BY_ADA));
    await cost("keepUpdateAddress", () => database.keepUpdateAddress("https://example.com/hook", BY_ADA));
    await cost("readUpdateAddress", () => database.readUpdateAddress());
    await cost("forgetUpdateAddress", () => database.forgetUpdateAddress(BY_ADA));
    await cost("forgetUpdateAddress, none kept", () => database.forgetUpdateAddress(BY_ADA));
    await cost("keepUpdateCheck", () => database.keepUpdateCheck({ checked_at: NOW, news: null }));
    await cost("readUpdateCheck", () => database.readUpdateCheck());
    await cost("keepAutoStart", () => database.keepAutoStart({ version: "0.2.0", at: NOW, taken: "0.2.0" }));
    await cost("keepSweepPlace", () => database.keepSweepPlace({ trash: false }));
    await cost("readSweepPlace", () => database.readSweepPlace());
    await cost("keepSweepPlace, forgotten", () => database.keepSweepPlace(undefined));

    const sites: Site[] = [];
    for (let index = 0; index < SITES; index += 1) sites.push(done(await database.createSite(site(index), { ...BY_ADA, at: NOW + index })).site);
    const [first, second, third, fourth, fifth, sixth] = sites as [Site, Site, Site, Site, Site, Site];

    await cost("createSite", () => database.createSite(site(SITES), BY_ADA));
    await cost("createSite, public", () => database.createSite({ ...draft("open" as SiteName, "public", "open" as PublicName), folder: folder(SITES + 1) }, BY_ADA));
    await cost("createSite, name taken", () => database.createSite({ ...draft("open" as SiteName, "public", "open" as PublicName), folder: folder(SITES + 2) }, BY_ADA));
    await cost("getSite", () => database.getSite(first.id));
    await cost("getSite, none", () => database.getSite(NOBODY));
    await cost("getSiteWithSettings", () => database.getSiteWithSettings(first.id));
    await cost("getSiteWithSettings, none", () => database.getSiteWithSettings(NOBODY));
    await cost("getShownSite, with the views and the publishers", () => database.getShownSite(first.id, { day: DAY, publishers: true }));
    await cost("getSiteNames", () => database.getSiteNames(sites.slice(0, 5).map((made) => made.id)));
    await cost("getSiteByPublicName", () => database.getSiteByPublicName("open" as PublicName));
    await cost("getSiteByFolder", () => database.getSiteByFolder(first.folder));
    await cost("findServed, by id", () => database.findServed({ id: first.id }, NOW));
    await cost("findServed, by public name", () => database.findServed({ public_name: "open" as PublicName }, NOW));
    await cost("readTotals", () => database.readTotals());
    await cost("exportSites", () => database.exportSites({ limit: 5 }));
    await cost("exportSites, after", () => database.exportSites({ limit: 5, after: first.id }));
    const moved = done(await cost("giveNewId", () => database.giveNewId(second.id, BY_ADA)));
    await cost("reserveVersion", () => database.reserveVersion(first.id));
    await cost("addVersion", () => database.addVersion(first.id, publish(2, 2), BY_ADA));
    await database.reserveVersion(first.id);
    await cost("addVersion, one dropped", () => database.addVersion(first.id, publish(3, 2), BY_ADA));
    await cost("setLiveVersion, a number", () => database.setLiveVersion(first.id, 2, BY_ADA));
    await cost("setLiveVersion, the same", () => database.setLiveVersion(first.id, 2, BY_ADA));
    await database.setLiveVersion(first.id, 3, BY_ADA);
    await cost("setLiveVersion, previous", () => database.setLiveVersion(first.id, "previous", BY_ADA));
    await cost("findServed, a site that keeps two versions", () => database.findServed({ id: first.id }, NOW));
    await cost("findServedWith, the day's counts", () => database.findServedWith({ id: first.id }, NOW, { counts: { day: DAY, site: first.id } }));
    await cost("findServedWith, the day's counts, the settings and the key", () => database.findServedWith({ id: first.id }, NOW, { counts: { day: DAY, site: first.id }, settingsAndKey: true }));
    await cost("trashSite", () => database.trashSite(third.id, BY_ADA));
    await cost("trashSite, in the trash", () => database.trashSite(third.id, BY_ADA));
    await cost("restoreSite", () => database.restoreSite(third.id, BY_ADA));
    await database.trashSite(third.id, BY_ADA);
    const removed = done(await cost("deleteSite", () => database.deleteSite(third.id, BY_ADA)));
    await cost("listLeftovers", () => database.listLeftovers({ limit: 10 }));
    await cost("storedBack: addUpload, importUploadAsSite, abandonUpload, removeUpload", () => storedBack(database, removed.site));
    await database.trashSite(fourth.id, BY_ADA);
    await database.deleteSite(fourth.id, BY_ADA);
    await cost("forgetLeftover", () => database.forgetLeftover(fourth.folder));

    const begun = await cost("addUpload, a new site", () => begunSite(database, site(SITES + 3)));
    await cost("getUpload", () => database.getUpload(begun.id));
    await cost("getUploadFile", () => database.getUploadFile(begun.id, "index.html"));
    await cost("getUploadFile, no such file", () => database.getUploadFile(begun.id, "nowhere.html"));
    await cost("getUploadFiles, two files and one that is not there", () => database.getUploadFiles(begun.id, ["index.html", "it's \"quoted\"/100%.css", "nowhere.html"]));
    await cost("listUploads", () => database.listUploads({ before: NOW + 1, limit: 10 }));
    await cost("publishUploadAsSite", () => database.publishUploadAsSite(begun.id, { ...begun.site, bytes: 1000, files: 2 }, BY_ADA));
    await cost("publishUploadAsSite, not pending", () => database.publishUploadAsSite(begun.id, { ...begun.site, bytes: 1000, files: 2 }, BY_ADA));
    await cost("setUploadDropped", () => database.setUploadDropped(begun.id, []));
    await cost("removeUpload", () => database.removeUpload(begun.id));
    const next = await cost("reserveVersion and addUpload, a version", () => begunVersion(database, first));
    await cost("publishUploadAsVersion, with access and details", () =>
      database.publishUploadAsVersion(next, { keep: 2, access: { access: "unlisted" }, details: { title: "Report" }, page_title: "Report" }, BY_ADA),
    );
    const plain = await begunVersion(database, first);
    await cost("publishUploadAsVersion, plain", () => database.publishUploadAsVersion(plain, { keep: 2, details: {} }, BY_ADA));
    const given = await cost("addUpload, 500 files", () => begunFiles(database, numberedFiles(500)));
    await cost("abandonUpload", () => database.abandonUpload(given));

    const admin = (await mintToken({ scope: "admin", note: "laptop", now: NOW })).record;
    const publisher = (await mintToken({ scope: "publisher", note: "ci", now: NOW })).record;
    await cost("addToken", () => database.addToken(admin, BY_ADA));
    await database.addToken(publisher, BY_ADA);
    await cost("getToken", () => database.getToken(admin.id));
    await cost("listTokens", () => database.listTokens());
    await cost("getTokenNames, 1 of 2", () => database.getTokenNames([publisher.id]));
    await cost("getTokenNames, 1 of 2 among 250 ids", () => database.getTokenNames([...Array.from({ length: 249 }, (_none, index) => index.toString(16).padStart(16, "0") as TokenId), publisher.id]));
    await cost("revokeToken", () => database.revokeToken(admin.id, BY_ADA));
    await cost("listTokenStates", () => database.listTokenStates(NOW + 1, 50));
    const login = await pendingLogin(NOW, "one-visitor");
    await cost("addComputerLogin", () => database.addComputerLogin(login, ROOM));
    await database.addComputerLogin(await pendingLogin(NOW + 1, "another-visitor"), ROOM);
    await cost("getComputerLogin", () => database.getComputerLogin(login.id));
    await cost("findComputerLogin", () => database.findComputerLogin(login.code));
    await cost("listWaitingComputerLogins", () => database.listWaitingComputerLogins(NOW + 2));
    await cost("decideComputerLogin", () => database.decideComputerLogin(login.code, { state: "allowed", by: ADMIN, at: NOW + 2 }));
    const redeemed = (await mintToken({ scope: "publisher", note: "laptop", now: NOW + 3 })).record;
    await cost("redeemComputerLogin", () => database.redeemComputerLogin(login.id, redeemed));
    await cost("sweepRunOut", () => database.sweepRunOut(NOW + 86_400_000));

    await cost("hasLoggedIn, nobody yet", () => database.hasLoggedIn());
    await cost("appendAudit, a login", () => database.appendAudit({ action: "login", detail: {} }, BY_ADA));
    await cost("hasLoggedIn", () => database.hasLoggedIn());
    await cost("addRequests", () => database.addRequests({ day: DAY, site: first.id, requests: 3, views: 1 }));
    await cost("addRequests, again", () => database.addRequests({ day: DAY, site: first.id, requests: 3, views: 1 }));
    await cost("readRequests", () => database.readRequests(DAY, first.id));
    await cost("readRequests, all sites", () => database.readRequests(DAY));
    await cost("readViews", () => database.readViews(sites.slice(0, 5).map((made) => made.id), DAY));
    await cost("readDailyViews, 30 days", () => database.readDailyViews(sites.slice(0, 5).map((made) => made.id), DAY, 30));
    await cost("readDailyViews, a year", () => database.readDailyViews(sites.slice(0, 5).map((made) => made.id), DAY, 365));
    // Fifty ids, the most one read takes: the sites there are, and ids no site has.
    const fifty = [...sites.map((made) => made.id), ...Array.from({ length: 50 - SITES }, (_none, at) => `none${String(at).padStart(8, "0")}` as SiteId)];
    await cost("readDailyViews, a year, fifty sites", () => database.readDailyViews(fifty, DAY, 365));

    const page = await cost("listSites", () => database.listSites({ trash: false, limit: 5 }));
    await cost("listShownSites, with the views and the publishers", () => database.listShownSites({ trash: false, limit: 5 }, { day: DAY, publishers: true }));
    await cost("listShownSites, with the views", () => database.listShownSites({ trash: false, limit: 5 }, { day: DAY, publishers: false }));
    await cost("listSites, the next page", () => database.listSites({ trash: false, limit: 5, ...(page.next === undefined ? {} : { after: page.next }) }));
    await cost("listSites, by name, one holder, a text, an access", () =>
      database.listSites({ trash: false, limit: 5, sort: "name", owner: BY_ADA.by, named: "site-1", access: "private", expires: "never" }),
    );
    await cost("listSites, by access", () => database.listSites({ trash: false, limit: 5, sort: "access", dir: "desc" }));
    await cost("changeAccess", () => database.changeAccess(fifth.id, { access: "public", public_name: "blog" as PublicName }, BY_ADA));
    await cost("changeAccess, the same", () => database.changeAccess(fifth.id, { access: "public", public_name: "blog" as PublicName }, BY_ADA));
    await cost("changeAccess, name taken", () => database.changeAccess(sixth.id, { access: "public", public_name: "blog" as PublicName }, BY_ADA));
    await cost("changeDetails", () => database.changeDetails(sixth.id, { title: "Report", search_engines: true }, BY_ADA));
    await cost("changeDetails, the same", () => database.changeDetails(sixth.id, { title: "Report", search_engines: true }, BY_ADA));
    await cost("listAudit", () => database.listAudit({ limit: 20 }));
    await cost("searchAudit, one kind, the sites named with a text", () => database.searchAudit({ limit: 20, actions: ["create"], site: "site-1" }));
    await cost("listAudit, the oldest first", () => database.listAudit({ limit: 20, dir: "asc" }));
    await cost("searchAudit, the oldest first, the next page of one kind", () => database.searchAudit({ limit: 20, dir: "asc", after: 20, actions: ["create"] }));
    await cost("listAudit, a reading for a file", () => database.listAudit({ limit: 1000 }));
    await cost("listNamedAudit", () => database.listNamedAudit({ limit: 20 }));
    await cost("searchNamedAudit, one kind, the sites named with a text", () => database.searchNamedAudit({ limit: 20, actions: ["create"], site: "site-1" }));
    await cost("listNamedAudit, a reading for a file", () => database.listNamedAudit({ limit: 1000 }));
    await cost("endOfAuditPart, of twenty entries", () => database.endOfAuditPart({ entries: 20 }));
    await cost("countAudit", () => database.countAudit({ most: 10_000 }));
    await cost("countAudit, one kind, the sites named with a text", () => database.countAudit({ most: 10_000, actions: ["create"], site: "site-1" }));
    await cost("countAudit, no further back than five entries, and where the log starts", () => database.countAudit({ most: 5, actions: ["create"] }));

    await database.trashSite(sixth.id, BY_ADA);
    const version: Parameters<typeof database.publishUploadAsVersion>[1] = { keep: 2, details: {} };
    await cost("no site: getSiteByPublicName", () => database.getSiteByPublicName("nobody" as PublicName));
    await cost("no site: giveNewId", () => database.giveNewId(NOBODY, BY_ADA));
    await cost("no site: reserveVersion", () => database.reserveVersion(NOBODY));
    await cost("no site: addVersion", () => database.addVersion(NOBODY, publish(2, 2), BY_ADA));
    await cost("no site: setLiveVersion", () => database.setLiveVersion(NOBODY, 1, BY_ADA));
    await cost("no site: trashSite", () => database.trashSite(NOBODY, BY_ADA));
    await cost("no site: restoreSite", () => database.restoreSite(NOBODY, BY_ADA));
    await cost("no site: deleteSite", () => database.deleteSite(NOBODY, BY_ADA));
    await cost("in the trash: findServed", () => database.findServed({ id: sixth.id }, NOW));
    await cost("in the trash: giveNewId", () => database.giveNewId(sixth.id, BY_ADA));
    await cost("in the trash: reserveVersion", () => database.reserveVersion(sixth.id));
    await cost("in the trash: changeAccess", () => database.changeAccess(sixth.id, { access: "unlisted" }, BY_ADA));
    await cost("in the trash: changeDetails", () => database.changeDetails(sixth.id, { title: "Notes" }, BY_ADA));
    await cost("refused: restoreSite, a live site", () => database.restoreSite(first.id, BY_ADA));
    await cost("refused: addVersion, a number not set aside", () => database.addVersion(first.id, publish(99, 2), BY_ADA));
    await cost("refused: setLiveVersion, no such version", () => database.setLiveVersion(first.id, 99, BY_ADA));
    await cost("refused: publishUploadAsVersion, not pending", () => database.publishUploadAsVersion(plain, version, BY_ADA));
    await cost("refused: removeUpload, none", () => database.removeUpload(begun.id));
    await cost("refused: abandonUpload, not pending", () => database.abandonUpload(given));
    await cost("refused: addUpload, its holder's room is full", () =>
      database.addUpload(
        { id: "0000000000000000" as UploadId, folder: folder(SITES + 9), number: 1, owner: BY_ADA.by, plan: { kind: "import", site: {} }, manifest: numberedFiles(2), created_at: NOW },
        { own: 0, folderBytes: 1_000_000, staying: 0, totalBytes: 1_000_000, sites: null, day: DAY, dayFiles: 1_000_000, writes: 2, dayWrites: 1_000_000 },
      ),
    );
    await cost("refused: addToken, the id is taken", () => database.addToken(publisher, BY_ADA));
    await cost("refused: revokeToken, none", () => database.revokeToken(admin.id, BY_ADA));
    await cost("refused: decideComputerLogin, none waits", () => database.decideComputerLogin(login.code, { state: "denied", by: ADMIN, at: NOW + 4 }));
    await cost("refused: redeemComputerLogin, none allowed", () => database.redeemComputerLogin(login.id, redeemed));

    // Last, so that the two audit entries they write are read by no page of the log above.
    await cost("keepDomainCheck", () => database.keepDomainCheck({ ran_at: NOW, by: BY_ADA.by, run: "check", pieces: [] }, {}));
    const pieces = Array.from({ length: 200 }, (_piece, at) => ({ piece: "Record", detail: `record ${at}`, part: "reach", state: "needs_repair" }) as const);
    await cost("keepDomainCheck, 200 pieces over the run before", () => database.keepDomainCheck({ ran_at: NOW + 1, by: BY_ADA.by, run: "repair", pieces }, { run: "repair" }));
    await cost("readDomainCheck", () => database.readDomainCheck());
    const carried = (await database.readSettings())?.logins ?? [];
    await cost("claimUsers", () => database.claimUsers(NOW + 2));
    await cost("settleUsers, the stored logins carried", () => database.settleUsers({ logins: carried, since: NOW + 2 }, NOW + 2));
    await cost("settleUsers, a try whose outcome is unknown", () => database.settleUsers({ logins: null, since: NOW + 2 }, NOW + 2));
    await database.changeSettings({ outside_pages: "allowed" }, { by: BY_ADA.by, at: NOW + 3 });
    await cost("claimRules", () => database.claimRules(NOW + 4));
    await cost("settleRules, the stored settings carried", () => database.settleRules({ rules: { outside_pages: "allowed", search_engines_allowed: false }, since: NOW + 4 }, NOW + 4));
    await cost("claimRules, nothing waits", () => database.claimRules(NOW + 5));
    await cost("readFrame", () => database.readFrame(NOW));

    const note = { kind: "request_failed", count: 1, more: false, name: "TypeError", message: "m".repeat(200) } as const;
    const limit = { kind: "files_limit_reached", count: 1, more: false, name: null, message: null } as const;
    await cost("noteProblem, the day's first", () => database.noteProblem({ ...note, at: MIDNIGHT }));
    await cost("noteProblem, the same hour", () => database.noteProblem({ ...note, at: MIDNIGHT + 1 }));
    await cost("noteProblem, a later hour", () => database.noteProblem({ ...note, at: MIDNIGHT + 3_600_000 }));
    await cost("noteProblem, once a day", () => database.noteProblem({ ...limit, at: MIDNIGHT }));
    await cost("noteProblem, once a day and noted", () => database.noteProblem({ ...limit, at: MIDNIGHT + 3_600_000 }));
    for (const kind of PROBLEM_KINDS) {
      for (let day = 1; day <= 7; day += 1) await database.noteProblem({ ...note, kind, at: MIDNIGHT + day * 86_400_000 });
    }
    await cost("listProblems, 7 days of 12 kinds", () => database.listProblems(dayOf(MIDNIGHT + 86_400_000)));
    await cost("sweepRunOut, 14 problems past the days kept", () => database.sweepRunOut(MIDNIGHT + 31 * 86_400_000));
    await cost("changeAccessAndDetails", () => database.changeAccessAndDetails(first.id, { access: "unlisted" }, { title: "Both" }, BY_ADA));
    await cost("changeAccessAndDetails, the same", () => database.changeAccessAndDetails(first.id, { access: "unlisted" }, { title: "Both" }, BY_ADA));
    const copy = await begunSite(database, site(900));
    await cost("publishUploadAsSite, a copy", () => database.publishUploadAsSite(copy.id, { ...copy.site, bytes: 1000, files: 2 }, BY_ADA, { copiedFrom: first.id }));

    // The logins change after every read of the log, so that the entries they write are read by no page of it above.
    const person = "bo@example.com" as Login;
    await cost("addLogin", () => database.addLogin(person, BY_ADA));
    await cost("addLogin, already one", () => database.addLogin(person, BY_ADA));
    await cost("removeLogin", () => database.removeLogin(person, BY_ADA));
    await cost("removeLogin, not one", () => database.removeLogin(person, BY_ADA));
    await cost("removeLogin, the last", () => database.removeLogin(ADMIN, BY_ADA));
    await cost("changeSettings, a login more", () => database.changeSettings({ logins: [ADMIN, person] }, BY_ADA));
    await cost("changeSettings, another first login", () => database.changeSettings({ logins: [person, ADMIN] }, BY_ADA));

    await cost("readStorageWrites", () => database.readStorageWrites(DAY));
    await cost("takeStorageWrite", () => database.takeStorageWrite(DAY, 0));
    await cost("takeStorageWrite, again", () => database.takeStorageWrite(DAY, 0));
    await cost("addStorageWrites", () => database.addStorageWrites(DAY, 3));

    const again = done(await database.giveNewId(moved.site.id, BY_ADA));
    // What a page of the log asks for the ids on it that are no site: here two a site gave up, one of them two new links ago, the id a site has now, and two no site ever had.
    await cost("getLaterSites", () => database.getLaterSites([second.id, moved.site.id, again.site.id, NOBODY, "yyyyyyyyyyyy" as SiteId]));
    // Last, so the line it adds to the log changes no count before it.
    await cost("noteLogin, a new login", () => database.noteLogin(ADMIN, { since: NOW + 10, at: NOW + 10 }));
    await cost("noteLogin, known", () => database.noteLogin(ADMIN, { since: NOW + 10, at: NOW + 20 }));

    expect(costs).toEqual(ROWS);
  });
});
