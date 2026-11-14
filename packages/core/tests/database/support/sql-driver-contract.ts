// What holds of the SQL implementation alone, as test cases that take a driver factory: the driver's batches, the migration runner, the schema's own rules, and how the engine runs each statement.
// What every `Database` keeps is in `database-contract.ts`. Importing this file registers nothing.

import { describe, expect, test } from "bun:test";

import { mintToken } from "../../../src/auth/tokens";
import type { Database } from "../../../src/database/database";
import type { SqlDriver, SqlValue, Statement, StatementResult } from "../../../src/database/driver";
import { openDatabase } from "../../../src/database/open";
import { SqlDatabase } from "../../../src/database/sql-database";
import { migrate, type Step, storedVersion } from "../../../src/migrations/migrate";
import { SCHEMA_VERSION, STEPS } from "../../../src/migrations/registry";
import type { SiteId } from "../../../src/sites/ids";
import {
  ADA,
  ADMIN,
  BY_ADA,
  begunImport,
  begunSite,
  begunVersion,
  DOCS,
  draft,
  FIRST_KEY,
  made,
  NO_SITE,
  NOW,
  OTHER_SITE,
  pendingLogin,
  publish,
  REPORT,
  SECOND_KEY,
  SETTINGS,
  TODAY,
  TOMORROW,
} from "./database-contract";

const STEP_THAT_FAILS_HALFWAY: Step = {
  number: SCHEMA_VERSION + 1,
  description: "add a notes table",
  statements: ["CREATE TABLE notes (text TEXT)", "INSERT INTO nowhere VALUES (1)"],
};

const MENDED_STEP: Step = { ...STEP_THAT_FAILS_HALFWAY, statements: ["CREATE TABLE notes (text TEXT)"] };

type DriverFactory = () => SqlDriver | Promise<SqlDriver>;

/** A driver that passes every batch on and keeps the statements, so a test can ask the engine how it runs each one. */
class RecordingDriver implements SqlDriver {
  readonly statements: Statement[] = [];
  readonly #inner: SqlDriver;

  constructor(inner: SqlDriver) {
    this.#inner = inner;
  }

  batch(statements: readonly Statement[]): Promise<readonly StatementResult[]> {
    this.statements.push(...statements);

    return this.#inner.batch(statements);
  }
}

/** Whether the totals row equals the counts and sums it stands for, taken afresh from every site and every version. */
const TOTALS_ARE_TRUE = `
SELECT t.sites = (SELECT COUNT(*) FROM sites)
  AND t.trashed_sites = (SELECT COUNT(*) FROM sites WHERE trashed_at IS NOT NULL)
  AND t.bytes = (SELECT COALESCE(SUM(bytes), 0) FROM versions)
  AND t.files = (SELECT COALESCE(SUM(files), 0) FROM versions) AS true_totals
FROM totals t`;

/** A driver that, after every batch it passes on, fails when the running totals differ from the recomputed ones: so every operation of every case is checked. */
class TotalsCheckingDriver implements SqlDriver {
  readonly #inner: SqlDriver;

  constructor(inner: SqlDriver) {
    this.#inner = inner;
  }

  async batch(statements: readonly Statement[]): Promise<readonly StatementResult[]> {
    const results = await this.#inner.batch(statements);
    const [checked] = await this.#inner.batch([{ sql: TOTALS_ARE_TRUE, params: [] }]);
    if (checked?.rows[0]?.true_totals !== 1) throw new Error(`the totals drifted from the sums after: ${statements[0]?.sql.trim().split("\n")[0]}`);

    return results;
  }
}

async function rows(driver: SqlDriver, sql: string, ...params: SqlValue[]): Promise<readonly Readonly<Record<string, unknown>>[]> {
  const [result] = await driver.batch([{ sql, params }]);

  return result?.rows ?? [];
}

async function migrated(makeDriver: DriverFactory): Promise<SqlDriver> {
  const driver = await makeDriver();
  await migrate(driver, STEPS, NOW);

  return new TotalsCheckingDriver(driver);
}

async function schemaOf(driver: SqlDriver): Promise<unknown> {
  return rows(driver, "SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY type, name");
}

function theDriver(label: string, makeDriver: DriverFactory): void {
  describe(`${label}: the driver`, () => {
    // Drift: every change relies on a batch being all or nothing; a driver that kept the first half would leave a change without its audit entry.
    test("a batch whose second statement fails keeps nothing of the first, and one that works reports rows and changes per statement", async () => {
      const driver = await makeDriver();
      await driver.batch([{ sql: "CREATE TABLE notes (id INTEGER PRIMARY KEY, text TEXT NOT NULL)", params: [] }]);
      const insert = { sql: "INSERT INTO notes (id, text) VALUES (?1, ?2)", params: [1, "first"] };

      await expect(driver.batch([insert, { sql: "INSERT INTO notes (id, text) VALUES (?1, ?2)", params: [1, "again"] }])).rejects.toThrow();
      expect(await rows(driver, "SELECT * FROM notes")).toEqual([]);

      const results = await driver.batch([
        insert,
        { sql: "UPDATE notes SET text = ?1 WHERE id > ?2", params: ["none", 5] },
        { sql: "SELECT id, text FROM notes", params: [] },
      ]);

      expect(results.map((result) => ({ rows: [...result.rows], changes: result.changes }))).toEqual([
        { rows: [], changes: 1 },
        { rows: [], changes: 0 },
        { rows: [{ id: 1, text: "first" }], changes: 0 },
      ]);
    });
  });
}

function migrations(label: string, makeDriver: DriverFactory): void {
  describe(`${label}: migrations`, () => {
    // Drift: a step that only works on the author's database, or that changes something on a second run, breaks every install at its next start.
    test.each(STEPS.map((step) => [step.number, step.description] as const))(
      "step %i (%s) runs from an empty database, and a second run changes nothing",
      async (number) => {
        const driver = await makeDriver();
        const upTo = STEPS.slice(0, number);
        const first = await migrate(driver, upTo, NOW);
        const schema = await schemaOf(driver);
        const second = await migrate(driver, upTo, NOW + 1);

        expect([first, second]).toEqual([
          { kind: "current", version: number, applied: upTo.map((step) => step.description) },
          { kind: "current", version: number, applied: [] },
        ]);
        expect(await schemaOf(driver)).toEqual(schema);
        expect(await rows(driver, "SELECT step, applied_at FROM schema_steps ORDER BY step")).toEqual(
          upTo.map((step) => ({ step: step.number, applied_at: NOW })),
        );
      },
    );

    // Drift: two Worker instances start at once after a deploy; a step applied twice, or a loser that reports failure, would break that start.
    test("two runners racing from an empty database both end current, and each step is applied exactly once", async () => {
      const driver = await makeDriver();
      const outcomes = await Promise.all([migrate(driver, STEPS, NOW), migrate(driver, STEPS, NOW), migrate(driver, STEPS, NOW)]);

      expect(outcomes.map((outcome) => outcome.kind)).toEqual(["current", "current", "current"]);
      expect(outcomes.flatMap((outcome) => (outcome.kind === "current" ? outcome.applied : []))).toEqual(STEPS.map((step) => step.description));
      expect(await storedVersion(driver)).toBe(SCHEMA_VERSION);
    });

    // Drift: an older Worker still running after a newer one migrated would write rows the newer schema does not expect.
    test("a database stamped by a newer poplin is refused with the upgrade named, and nothing in it changes", async () => {
      const driver = await migrated(makeDriver);
      await driver.batch([
        { sql: "INSERT INTO schema_steps (step, description, applied_at) VALUES (?1, ?2, ?3)", params: [SCHEMA_VERSION + 1, "a step of a later release", NOW] },
      ]);
      const schema = await schemaOf(driver);
      const opened = await openDatabase(driver, NOW);

      expect(opened).toEqual({
        kind: "newer",
        stored: SCHEMA_VERSION + 1,
        current: SCHEMA_VERSION,
        message: `the database is at schema version ${SCHEMA_VERSION + 1} and this poplin knows up to ${SCHEMA_VERSION}: update poplin`,
      });
      expect(await schemaOf(driver)).toEqual(schema);
    });

    // Drift: a half-applied step with its stamp set would never be finished; one with its changes kept and no stamp would fail again on the retry.
    test("a step that fails leaves the version and the schema as they were, and the mended step then runs", async () => {
      const driver = await migrated(makeDriver);
      const schema = await schemaOf(driver);
      const failed = await migrate(driver, [...STEPS, STEP_THAT_FAILS_HALFWAY], NOW);

      expect(failed).toMatchObject({ kind: "failed", stored: SCHEMA_VERSION, step: STEP_THAT_FAILS_HALFWAY.number });
      expect(failed.kind === "failed" ? failed.message : "").toMatch(/^the database could not be brought up to date: .* Try again$/);
      expect([await storedVersion(driver), await schemaOf(driver)]).toEqual([SCHEMA_VERSION, schema]);
      expect(await migrate(driver, [...STEPS, MENDED_STEP], NOW)).toEqual({
        kind: "current",
        version: STEP_THAT_FAILS_HALFWAY.number,
        applied: [MENDED_STEP.description],
      });
    });

    test("opening an empty database applies every step and hands back a database that works", async () => {
      const opened = await openDatabase(await makeDriver(), NOW);
      if (opened.kind !== "open") throw new Error(`the database did not open: ${opened.kind}`);

      expect(opened.applied).toEqual(STEPS.map((step) => step.description));
      expect(await opened.database.readSettings()).toBeUndefined();
    });
  });
}

function schemaRules(label: string, makeDriver: DriverFactory): void {
  describe(`${label}: what the schema itself refuses`, () => {
    const site = (id: string, folder: string, access: string, publicName: string | null): Statement => ({
      sql: "INSERT INTO sites (id, name, folder, access, public_name, search_engines, live_version, next_version, owner, created_at, updated_at) VALUES (?1, 'report', ?2, ?3, ?4, 0, 1, 2, ?5, 0, 0)",
      params: [id, folder, access, publicName, ADA],
    });
    const stored = site("aaaaaaaaaaaa", "folder-a", "public", "docs");
    const upload = (id: string, folder: string, state: string): Statement => ({
      sql: "INSERT INTO uploads (id, folder, number, owner, state, plan, manifest, bytes, files, created_at) VALUES (?1, ?2, 2, ?3, ?4, '{}', '[]', 0, 1, 0)",
      params: [id, folder, ADA, state],
    });
    const login = (id: string, code: string, state: string, decidedBy: string | null): Statement => ({
      sql: "INSERT INTO logins (id, code, hash, scope, computer, visitor, state, decided_by, created_at, expires_at) VALUES (?1, ?2, 'h', 'publisher', 'laptop', 'one-visitor', ?3, ?4, 0, 1)",
      params: [id, code, state, decidedBy],
    });

    // Drift: these are the states no code path may leave behind; each row is one written straight in SQL, past every check the code makes.
    test.each([
      ["a public site without a public name", [site("bbbbbbbbbbbb", "folder-b", "public", null)]],
      ["a private site with a public name", [site("bbbbbbbbbbbb", "folder-b", "private", "blog")]],
      ["an access that is none of the three", [site("bbbbbbbbbbbb", "folder-b", "secret", null)]],
      ["a public name another site holds", [site("bbbbbbbbbbbb", "folder-b", "public", "docs")]],
      ["a public name that is another site's id", [site("bbbbbbbbbbbb", "folder-b", "public", "aaaaaaaaaaaa")]],
      ["a public name that is the site's own id", [site("bbbbbbbbbbbb", "folder-b", "public", "bbbbbbbbbbbb")]],
      ["an id that is another site's public name", [site("docs", "folder-b", "private", null)]],
      ["an id changed to another site's public name", [{ sql: "UPDATE sites SET id = 'docs' WHERE id = 'aaaaaaaaaaaa'", params: [] }]],
      ["a second site with the same id", [site("aaaaaaaaaaaa", "folder-b", "private", null)]],
      ["a second site in the same folder", [site("bbbbbbbbbbbb", "folder-a", "private", null)]],
      ["a live version that is not kept", [{ sql: "UPDATE sites SET live_version = 9, next_version = 10 WHERE id = 'aaaaaaaaaaaa'", params: [] }]],
      ["a live version dropped from under its site", [{ sql: "DELETE FROM versions WHERE folder = 'folder-a'", params: [] }]],
      [
        "a version of no site",
        [{ sql: "INSERT INTO versions (folder, number, published_at, published_by, bytes, files) VALUES ('folder-of-no-site', 1, 0, ?1, 0, 0)", params: [ADA] }],
      ],
      ["a version of a negative size", [{ sql: "UPDATE versions SET bytes = -1 WHERE folder = 'folder-a'", params: [] }]],
      [
        "a version of unstated size",
        [{ sql: "INSERT INTO versions (folder, number, published_at, published_by) VALUES ('folder-a', 2, 0, ?1)", params: [ADA] }],
      ],
      ["a second row of totals", [{ sql: "INSERT INTO totals (id, sites, trashed_sites, bytes, files) VALUES (2, 0, 0, 0, 0)", params: [] }]],
      ["the totals row removed", [{ sql: "DELETE FROM totals", params: [] }]],
      ["a secret that is not the signing key", [{ sql: "INSERT INTO secrets (name, value, created_at) VALUES ('other', 'x', 0)", params: [] }]],
      ["a site moved to another folder", [{ sql: "UPDATE sites SET folder = 'folder-c' WHERE id = 'aaaaaaaaaaaa'", params: [] }]],
      ["an admin token that never expires", [{ sql: "INSERT INTO tokens (id, hash, scope, note, created_at) VALUES ('t', 'h', 'admin', '', 0)", params: [] }]],
      [
        "a publisher token that expires",
        [{ sql: "INSERT INTO tokens (id, hash, scope, note, created_at, expires_at) VALUES ('t', 'h', 'publisher', '', 0, 1)", params: [] }],
      ],
      ["a second row of settings", [{ sql: "INSERT INTO settings (id, value, updated_at) VALUES (2, '{}', 0)", params: [] }]],
      ["an upload in a state that is none of the three", [upload("upload-b", "folder-b", "live")]],
      ["a second upload under one folder and number", [upload("upload-b", "folder-a", "pending")]],
      ["an upload of no file", [{ sql: "UPDATE uploads SET files = 0 WHERE id = 'upload-a'", params: [] }]],
      ["an upload whose manifest is no JSON", [{ sql: "UPDATE uploads SET manifest = 'index.html' WHERE id = 'upload-a'", params: [] }]],
      ["a login that was allowed by nobody", [login("login-b", "CODEB", "allowed", null)]],
      ["a pending login somebody decided", [login("login-b", "CODEB", "pending", ADMIN)]],
      ["a login in a state that is none of the three", [login("login-b", "CODEB", "redeemed", ADMIN)]],
      ["a second login under one code", [login("login-b", "CODEA", "pending", null)]],
      ["a login that runs out before it was asked for", [{ sql: "UPDATE logins SET expires_at = 0 WHERE id = 'login-a'", params: [] }]],
      ["an audit entry rewritten", [{ sql: "UPDATE audit SET actor = 'someone' WHERE seq = 1", params: [] }]],
      ["an audit entry removed", [{ sql: "DELETE FROM audit WHERE seq = 1", params: [] }]],
    ] as ReadonlyArray<readonly [string, readonly Statement[]]>)("refuses %s", async (_state, statements) => {
      const driver = await migrated(makeDriver);
      await driver.batch([stored, upload("upload-a", "folder-a", "pending"), login("login-a", "CODEA", "pending", null), { sql: "INSERT INTO audit (at, actor, action, detail) VALUES (0, ?1, 'login', '{}')", params: [ADA] }]);

      await expect(driver.batch(statements)).rejects.toThrow();
    });
  });
}

function storedRows(label: string, makeDriver: DriverFactory): void {
  describe(`${label}: what the tables hold`, () => {
    // Drift: the class inserts a site and states the size of version 1 after it; without the trigger that statement would find no row, and a site would have no version.
    test("a site inserted straight in SQL gets its live version as a kept version of no size, and the totals count it", async () => {
      const driver = await migrated(makeDriver);
      await driver.batch([
        {
          sql: "INSERT INTO sites (id, name, folder, access, search_engines, live_version, next_version, owner, created_at, updated_at) VALUES ('aaaaaaaaaaaa', 'report', 'folder-a', 'private', 0, 3, 4, ?1, 5, 5)",
          params: [ADA],
        },
      ]);

      expect(await rows(driver, "SELECT folder, number, published_at, published_by, bytes, files FROM versions")).toEqual([
        { folder: "folder-a", number: 3, published_at: 5, published_by: ADA, bytes: 0, files: 0 },
      ]);
      expect(await rows(driver, "SELECT sites, trashed_sites, bytes, files FROM totals")).toEqual([{ sites: 1, trashed_sites: 0, bytes: 0, files: 0 }]);
    });

    // Drift: whoever reads the tables themselves, such as a migration step, relies on these forms, which no read of the interface shows.
    test("an audit detail is JSON text, the signing key is one row no audit row quotes, and a deleted site leaves no version row", async () => {
      const driver = await migrated(makeDriver);
      const database = new SqlDatabase(driver);
      const site = await made(database, draft(REPORT, "public", DOCS));
      await database.ensureSigningKey(FIRST_KEY, NOW);
      await database.rotateSigningKey(SECOND_KEY, { by: ADA, at: NOW + 2 });
      await database.deleteSite(site.id, BY_ADA);
      const audit = await rows(driver, "SELECT * FROM audit ORDER BY seq");
      const logged = JSON.stringify(audit);

      expect(audit.map((row) => [row.action, row.actor, row.site_id, row.site_name, row.detail])).toEqual([
        ["create", ADA, site.id, REPORT, '{"access":"public","public_name":"docs"}'],
        ["signed_everyone_out", ADA, null, null, "{}"],
        ["delete", ADA, site.id, REPORT, "{}"],
      ]);
      expect(["a1".repeat(32), "b2".repeat(32), "161,161", "178,178"].filter((needle) => logged.includes(needle))).toEqual([]);
      expect(await rows(driver, "SELECT name, created_at FROM secrets")).toEqual([{ name: "session_key", created_at: NOW + 2 }]);
      expect(await rows(driver, "SELECT * FROM versions")).toEqual([]);
    });
  });
}

function queryPlans(label: string, makeDriver: DriverFactory): void {
  describe(`${label}: how the engine runs each statement`, () => {
    // Drift: D1 bills and limits by rows read; one statement that walks a whole table costs a row per site on every request.
    test("no statement of any operation walks the sites table, or any table but the token list: every lookup and every page goes through a key or an index", async () => {
      const inner = await migrated(makeDriver);
      const driver = new RecordingDriver(inner);
      const database = new SqlDatabase(driver);
      await database.initSettings(SETTINGS, BY_ADA);
      const site = await made(database, draft(REPORT, "public", DOCS));
      const token = (await mintToken({ scope: "publisher", note: "ci", now: NOW })).record;
      await database.getSite(site.id);
      await database.getSiteByPublicName(DOCS);
      await database.findServed({ id: site.id }, NOW);
      await database.findServed({ public_name: DOCS }, NOW);
      await database.listSites({ trash: false, limit: 10 });
      await database.listSites({ trash: true, owner: ADA, limit: 10, after: { updated_at: NOW, id: site.id } });
      await database.listSites({ trash: false, limit: 10, after: { updated_at: NOW, id: site.id } });
      await database.changeAccess(site.id, { access: "unlisted" }, BY_ADA);
      await database.changeDetails(site.id, { title: "T", search_engines: true, embeddable: false, expires: NOW }, BY_ADA);
      await database.reserveVersion(site.id);
      await database.addVersion(site.id, publish(2, 3), BY_ADA);
      await database.setLiveVersion(site.id, "previous", BY_ADA);
      await database.setLiveVersion(site.id, 2, BY_ADA);
      await database.getSiteSize(site.id);
      await database.readTotals();
      const exported = await database.exportSites({ limit: 10, after: NO_SITE });
      await database.exportSites({ limit: 10 });
      await database.readSigningKey();
      await database.ensureSigningKey(FIRST_KEY, NOW);
      await database.rotateSigningKey(SECOND_KEY, BY_ADA);
      const moved = await database.giveNewId(site.id, BY_ADA);
      const id = moved.kind === "done" ? moved.site.id : site.id;
      await database.trashSite(id, BY_ADA);
      await database.restoreSite(id, BY_ADA);
      const deleted = await database.deleteSite(id, BY_ADA);
      const imported = deleted.kind === "done" ? await database.importSite(deleted.site, BY_ADA) : deleted;
      await database.addToken(token, BY_ADA);
      await database.getToken(token.id);
      await database.listTokens();
      await database.revokeToken(token.id, BY_ADA);
      await database.readSettings();
      await database.changeSettings({ trash_days: 30 }, BY_ADA);
      await database.appendAudit({ action: "login", detail: {} }, BY_ADA);
      await database.listAudit({ limit: 10 });
      const created = await begunSite(database, draft(REPORT));
      const updated = await begunVersion(database, imported.kind === "done" ? imported.site : site);
      await database.getUpload(created.id);
      await database.getUploadFile(created.id, "index.html");
      await database.getSiteByFolder(site.folder);
      await database.publishUploadAsSite(created.id, created.site, BY_ADA);
      await database.publishUploadAsVersion(updated, { keep: 1, access: { access: "public", public_name: DOCS }, details: { title: "Q3 sales" } }, BY_ADA);
      await database.listUploads({ before: NOW + 1, limit: 10, after: { created_at: NOW, id: created.id } });
      await database.abandonUpload((await begunSite(database, draft(REPORT))).id);
      await database.setUploadDropped(updated, []);
      await database.removeUpload(created.id);
      const gone = await made(database, draft(REPORT));
      await database.deleteSite(gone.id, BY_ADA);
      const restored = await begunImport(database, gone);
      const again = await database.importUploadAsSite(restored.id, restored.site, BY_ADA);
      const [login, denied] = await Promise.all([pendingLogin(), pendingLogin()]);
      await database.addComputerLogin(login, { perVisitor: 10, all: 10 });
      await database.addComputerLogin(denied, { perVisitor: 10, all: 10 });
      await database.getComputerLogin(login.id);
      await database.findComputerLogin(login.code);
      await database.pollComputerLogin(login.id, { at: NOW + 1, notAfter: NOW });
      await database.decideComputerLogin(login.code, { state: "allowed", by: ADMIN, at: NOW + 1 });
      await database.decideComputerLogin(denied.code, { state: "denied", by: ADMIN, at: NOW + 1 });
      const redeemed = await database.redeemComputerLogin(login.id, (await mintToken({ scope: "publisher", note: "laptop", now: NOW + 2 })).record);
      const swept = await database.sweepComputerLogins(denied.expiresAt);
      await database.listLeftovers({ limit: 10, after: gone.folder });
      await database.forgetLeftover(gone.folder);
      await storedVersion(driver);

      const scans: string[] = [];
      for (const statement of driver.statements) {
        const plan = await rows(inner, `EXPLAIN QUERY PLAN ${statement.sql}`, ...statement.params);
        const steps = plan.map((step) => String(step.detail));
        scans.push(
          ...steps
            .filter((step) => /\bSCAN\b/.test(step) && !/\bSCAN (CONSTANT ROW|sqlite_master|j VIRTUAL TABLE)\b/.test(step))
            .map((step) => `${step} <- ${statement.sql.trim().split("\n")[0]}`),
        );
      }

      // The one walk of a table is the token list, which hands back every row it reads. An import walks the list of versions it was given, and a file lookup the manifest of its own row: neither is a table.
      expect([exported.sites, imported.kind, again.kind, redeemed.kind, swept]).toEqual([[], "done", "done", "done", 1]);
      expect(driver.statements.length).toBeGreaterThan(105);
      expect(scans).toEqual([
        "SCAN tokens USING INDEX tokens_by_creation <- SELECT id, hash, scope, note, created_at, expires_at FROM tokens ORDER BY created_at DESC, id DESC",
      ]);
    });
  });
}

function requestCountRows(label: string, makeDriver: DriverFactory): void {
  describe(`${label}: the rows of the day's request counts`, () => {
    // Drift: the table is meant to hold one day; rows of earlier days left behind would grow it by a row per site every day.
    test("the table holds the newest day alone: a row per counted site, and one under the empty site for all of them", async () => {
      const driver = await migrated(makeDriver);
      const database = new SqlDatabase(driver);
      await database.addRequests({ day: TODAY, site: NO_SITE, requests: 50 });
      await database.addRequests({ day: TODAY, site: OTHER_SITE, requests: 1 });
      await database.addRequests({ day: TOMORROW, site: OTHER_SITE, requests: 2 });

      expect(await rows(driver, "SELECT day, site, requests FROM request_counts ORDER BY site")).toEqual([
        { day: TOMORROW, site: "", requests: 2 },
        { day: TOMORROW, site: OTHER_SITE, requests: 2 },
      ]);
    });

    // Drift: D1 limits rows read and written a day; a count that walked the table would cost a row per site on every counted request.
    test("counting and reading go through the key: no statement walks the table", async () => {
      const inner = await migrated(makeDriver);
      const driver = new RecordingDriver(inner);
      const database = new SqlDatabase(driver);
      await database.addRequests({ day: TODAY, site: NO_SITE, requests: 1 });
      await database.readRequests(TODAY, NO_SITE);
      const scans: string[] = [];

      for (const statement of driver.statements) {
        const plan = await rows(inner, `EXPLAIN QUERY PLAN ${statement.sql}`, ...statement.params);
        scans.push(...plan.map((step) => String(step.detail)).filter((step) => /\bSCAN\b/.test(step)));
      }

      expect([driver.statements.length, scans]).toEqual([5, []]);
    });
  });
}

/**
 * Make the factory `describeDatabase` takes from a driver factory: the SQL implementation over a migrated driver.
 *
 * After every batch of the database it gives, the totals row is checked against the sums over the sites and versions tables.
 *
 * @param makeDriver - gives a new, empty database on every call
 */
export function sqlDatabaseOver(makeDriver: DriverFactory): (mintId?: () => SiteId) => Promise<Database> {
  return async (mintId) => new SqlDatabase(await migrated(makeDriver), mintId);
}

/**
 * Register what holds of the SQL implementation alone, over one SQL driver.
 *
 * @param makeDriver - gives a new, empty database on every call
 */
export function describeSqlDriver(label: string, makeDriver: DriverFactory): void {
  theDriver(label, makeDriver);
  migrations(label, makeDriver);
  schemaRules(label, makeDriver);
  storedRows(label, makeDriver);
  queryPlans(label, makeDriver);
  requestCountRows(label, makeDriver);
}

