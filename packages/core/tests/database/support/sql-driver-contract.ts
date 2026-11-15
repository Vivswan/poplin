// What holds of the SQL implementation alone, as test cases that take a driver factory: the driver's batches, the migration runner, the schema's own rules, and how the engine runs each statement.
// What every `Database` keeps is in `database-contract.ts`. Importing this file registers nothing.

import { describe, expect, test } from "bun:test";

import type { Login } from "../../../src/auth/logins";
import { mintToken } from "../../../src/auth/tokens";
import { AUDIT_WINDOW, type Database } from "../../../src/database/database";
import { AllowanceSpent, type SqlDriver, type SqlValue, type Statement, type StatementResult } from "../../../src/database/driver";
import { openDatabase } from "../../../src/database/open";
import { SqlDatabase } from "../../../src/database/sql-database";
import { migrate, readStanding, type Step } from "../../../src/migrations/migrate";
import { STEPS } from "../../../src/migrations/registry";
import type { ManifestFile } from "../../../src/records/upload";
import type { SiteId } from "../../../src/sites/ids";
import {
  ADA,
  ADMIN,
  BY_ADA,
  begunFiles,
  begunImport,
  begunSite,
  begunVersion,
  DOCS,
  draft,
  FIRST_KEY,
  made,
  NO_SITE,
  NOW,
  numberedFiles,
  OTHER_SITE,
  pendingLogin,
  publish,
  REPORT,
  SECOND_KEY,
  SETTINGS,
  storedBack,
  TODAY,
  TOMORROW,
} from "./database-fixtures";

const SCHEMA_VERSION = STEPS.length;

const STEP_THAT_FAILS_HALFWAY: Step = {
  number: SCHEMA_VERSION + 1,
  description: "add a notes table",
  statements: ["CREATE TABLE notes (text TEXT)", "INSERT INTO nowhere VALUES (1)"],
};

const FIRST_STEP_OF_ANOTHER_BUILD: Step = { number: 1, description: "create the schema", statements: [...(STEPS[0]?.statements ?? []), "CREATE TABLE notes (text TEXT)"] };

const MADE_BY_ANOTHER_BUILD = {
  kind: "differs" as const,
  stored: 1,
  step: 1,
  message: `step 0001 (${STEPS[0]?.description}) of the database was applied by another build of poplin, so its tables are not the ones this build reads. Run the build that made the database, or delete the database and poplin makes it anew`,
};

const LEDGER_WITHOUT_FINGERPRINTS: readonly Statement[] = [
  { sql: "CREATE TABLE schema_steps (step INTEGER NOT NULL PRIMARY KEY, description TEXT NOT NULL, applied_at INTEGER NOT NULL) STRICT", params: [] },
  { sql: "INSERT INTO schema_steps (step, description, applied_at) VALUES (1, 'create the schema', ?1)", params: [NOW] },
];

const MENDED_STEP: Step = { ...STEP_THAT_FAILS_HALFWAY, statements: ["CREATE TABLE notes (text TEXT)"] };

const AWKWARD_MANIFESTS: readonly (readonly [name: string, paths: readonly string[]])[] = [
  ["dots, digits, JSON path signs, and the names an object is born with", ["index.html", "2024", "10", "9", "$", "$.a", "$[0]", "a.b[0]", "[1]", "..", "a..b", ".well-known/x", "constructor", "__proto__", "toString"]],
  ["quotes, backslashes, line breaks, and the signs that end a key", ['say "hi"', 'x",[[y', 'f0",[[', 'abc",[["z",1', "a\\b", 'a\\",[[', "line\nbreak", "\u0000", "\ud800 alone", "it's"]],
  ["letters beyond ASCII, composed and not", ["\u00fc/\u{1F600}.html", "e\u0301.html", "\u2028", "\u65e5\u672c/\u8a9e.html"]],
  ["a path of 1,009 bytes beside one of a single character", [`${"long/".repeat(200)}page.html`, " ", "a"]],
  // By the FNV-1a rule `ppkttia` hashes to 0, `painnxw` and `podj2jr` to 4, `p1fi6x1` to 10 in hex, and the two pages to 96444b56.
  ["paths that share a key, among them a key of one digit", ["page-2794.html", "ppkttia", "painnxw", "p1fi6x1", "podj2jr", "page-64060.html", "ppktti"]],
  ["an order that is not the sorted one", ["z.html", "index.html", "m/2.html", "a.html", "m/10.html", "m/1.html"]],
  ...[1, 2, 3, 4, 5, 8, 9].map((count) => [`${count} paths of differing lengths`, Array.from(Array(count).keys(), (index) => `${"x".repeat(index * 3)}${index}`)] as const),
];

type DriverFactory = () => SqlDriver | Promise<SqlDriver>;

/** How many entries the long log holds: one about `report`, then five logins more than a window holds, then one about `docs`. */
const LONG_LOG_ENTRIES = AUDIT_WINDOW + 7;

/** Writes the long log in one statement: its first entry is about the site `report`, its last about `docs`, and every one between is a login. */
export const LONG_LOG = `
INSERT INTO audit (at, actor, action, site_id, site_name, detail)
WITH RECURSIVE entry(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM entry WHERE n < ${LONG_LOG_ENTRIES})
SELECT 1700000000000, '00000000000000aa',
  CASE WHEN n IN (1, ${LONG_LOG_ENTRIES}) THEN 'create' ELSE 'login' END,
  CASE n WHEN 1 THEN 'aaaaaaaaaaaa' WHEN ${LONG_LOG_ENTRIES} THEN 'bbbbbbbbbbbb' END,
  CASE n WHEN 1 THEN 'report' WHEN ${LONG_LOG_ENTRIES} THEN 'docs' END,
  '{}'
FROM entry`;

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

/** The stored text of a manifest as the plain way of building it writes it: an object filled key by key and written whole. A key is `f` and the hex of the path's 32-bit FNV-1a hash over its UTF-16 units. */
function plainManifestText(manifest: readonly ManifestFile[]): string {
  const keyed: Record<string, unknown[][]> = {};

  manifest.forEach((file, place) => {
    let hash = 0x811c9dc5;
    for (let at = 0; at < file.path.length; at += 1) hash = Math.imul(hash ^ file.path.charCodeAt(at), 0x01000193);

    const key = `f${(hash >>> 0).toString(16)}`;
    keyed[key] = [...(keyed[key] ?? []), [file.path, file.size, file.content_type, place]];
  });

  return JSON.stringify(keyed);
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
      expect(await readStanding(driver, STEPS)).toEqual({ kind: "at", version: SCHEMA_VERSION });
    });

    // Drift: a step changed in place keeps its number, so a database an earlier build made counts as up to date and every statement written for the new tables fails on it, one request at a time.
    test.each([
      ["whose first step ran other statements", (driver: SqlDriver) => migrate(driver, [FIRST_STEP_OF_ANOTHER_BUILD], NOW)],
      ["whose ledger holds no fingerprint", (driver: SqlDriver) => driver.batch(LEDGER_WITHOUT_FINGERPRINTS)],
    ])("a database %s is refused as made by another build, and nothing in it changes", async (_name, make) => {
      const driver = await makeDriver();
      await make(driver);
      const held = async (): Promise<unknown> => [await schemaOf(driver), await rows(driver, "SELECT * FROM schema_steps")];
      const before = await held();

      expect([await openDatabase(driver, NOW), await readStanding(driver, STEPS)]).toEqual([MADE_BY_ANOTHER_BUILD, MADE_BY_ANOTHER_BUILD]);
      expect(await held()).toEqual(before);
    });

    // Drift: an older Worker still running after a newer one migrated would write rows the newer schema does not expect.
    test("a database stamped by a newer poplin is refused with the upgrade named, and nothing in it changes", async () => {
      const driver = await migrated(makeDriver);
      await driver.batch([
        { sql: "INSERT INTO schema_steps (step, description, applied_at, fingerprint) VALUES (?1, ?2, ?3, 'later')", params: [SCHEMA_VERSION + 1, "a step of a later release", NOW] },
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
      expect([await readStanding(driver, STEPS), await schemaOf(driver)]).toEqual([{ kind: "at", version: SCHEMA_VERSION }, schema]);
      expect(await migrate(driver, [...STEPS, MENDED_STEP], NOW)).toEqual({
        kind: "current",
        version: STEP_THAT_FAILS_HALFWAY.number,
        applied: [MENDED_STEP.description],
      });
    });

    // Drift: a step the day's allowance stopped did not fail. Told as a failed step, it sends a person to try again at once, where the wait is to midnight UTC.
    test("a step the database refuses because its day's allowance is used up is thrown as that, and the version stays", async () => {
      const inner = await makeDriver();
      const spent: SqlDriver = { batch: (statements) => (statements.some((statement) => statement.sql.startsWith("INSERT")) ? Promise.reject(new AllowanceSpent("writing")) : inner.batch(statements)) };

      await expect(migrate(spent, STEPS, NOW)).rejects.toThrow(AllowanceSpent);
      expect(await readStanding(inner, STEPS)).toEqual({ kind: "at", version: 0 });
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
      sql: "INSERT INTO uploads (id, folder, number, owner, state, plan, manifest, bytes, files, created_at) VALUES (?1, ?2, 2, ?3, ?4, '{}', '{}', 0, 1, 0)",
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
      ["an upload whose manifest is a list", [{ sql: "UPDATE uploads SET manifest = '[]' WHERE id = 'upload-a'", params: [] }]],
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
      await expect(rows(driver, "INSERT INTO secrets (name, value, created_at) VALUES ('another_secret', 'x', 1)")).rejects.toThrow();
      expect(await rows(driver, "SELECT * FROM versions")).toEqual([]);
    });
  });
}

function queryPlans(label: string, makeDriver: DriverFactory): void {
  describe(`${label}: how the engine runs each statement`, () => {
    // Drift: D1 bills and limits by rows read; one statement that walks a whole table costs a row per site on every request.
    test("no statement walks a table but the token list, the logins, the newest entries a count of the log is held to, and the sites, once, for a search of the log by a site: every other lookup and every page goes through a key or an index", async () => {
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
      await database.readTotals();
      const exported = await database.exportSites({ limit: 10, after: NO_SITE });
      await database.exportSites({ limit: 10 });
      await database.readSigningKey();
      await database.ensureSigningKey(FIRST_KEY, NOW);
      await database.rotateSigningKey(SECOND_KEY, BY_ADA);
      const moved = await database.giveNewId(site.id, BY_ADA);
      const id = moved.kind === "done" ? moved.site.id : site.id;
      await database.getLaterSites([site.id, NO_SITE]);
      await database.trashSite(id, BY_ADA);
      await database.restoreSite(id, BY_ADA);
      const deleted = await database.deleteSite(id, BY_ADA);
      const imported = deleted.kind === "done" ? await storedBack(database, deleted.site) : deleted;
      await database.addToken(token, BY_ADA);
      await database.getToken(token.id);
      await database.listTokens();
      await database.listTokenStates(NOW, 50);
      await database.revokeToken(token.id, BY_ADA);
      await database.readSettings();
      await database.changeSettings({ trash_days: 30 }, BY_ADA);
      await database.addLogin("bo@example.com" as Login, BY_ADA);
      await database.removeLogin("bo@example.com" as Login, BY_ADA);
      await database.appendAudit({ action: "login", detail: {} }, BY_ADA);
      await database.listAudit({ limit: 10 });
      await database.listAudit({ limit: 10, dir: "asc" });
      await database.listAudit({ limit: 10, dir: "asc", after: 1 });
      await database.countAudit({ most: 10, actions: ["login"] });
      await database.countAudit({ most: 10, actions: ["login"], site: "report" });
      await database.endOfAuditPart({ entries: 2, after: 9 });
      await database.searchAudit({ limit: 10, actions: ["login"], site: "report" });
      await database.searchAudit({ limit: 10, dir: "asc", after: 3, site: "report" });
      await database.searchAudit({ limit: 10, actions: ["login"], of: site.id });
      await database.countAudit({ most: 10, of: site.id });
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
      await database.listWaitingComputerLogins(NOW);
      await database.decideComputerLogin(login.code, { state: "allowed", by: ADMIN, at: NOW + 1 });
      await database.decideComputerLogin(denied.code, { state: "denied", by: ADMIN, at: NOW + 1 });
      const redeemed = await database.redeemComputerLogin(login.id, (await mintToken({ scope: "publisher", note: "laptop", now: NOW + 2 })).record);
      const swept = await database.sweepComputerLogins(denied.expiresAt);
      await database.listLeftovers({ limit: 10, after: gone.folder });
      await database.forgetLeftover(gone.folder);
      await readStanding(driver, STEPS);

      const scans: string[] = [];
      for (const statement of driver.statements) {
        const plan = await rows(inner, `EXPLAIN QUERY PLAN ${statement.sql}`, ...statement.params);
        const steps = plan.map((step) => String(step.detail));
        scans.push(
          ...steps
            .filter((step) => /\bSCAN\b/.test(step) && !/\bSCAN (CONSTANT ROW|sqlite_master|j VIRTUAL TABLE|\(subquery-1\))/.test(step))
            .map((step) => `${step} <- ${statement.sql.trim().split("\n")[0]}`),
        );
      }

      // The two token lists walk the tokens that were not removed, and the sweep walks the logins, which the room keeps few. An import walks the list of versions it was given, and a new login the visitors its own count gave: neither is a table.
      // The ledger holds one row a step. A count of the log walks its newest entries, as many as it is told, and then what it read of them.
      // A search of the log by a site reads the sites once: the log holds no title, and a text finds a site by the one it has now. Each earlier id is read once with them, through its index.
      const holds = '(instr("sites"."name", lower(?)) > 0 OR instr(lower(coalesce("sites"."title", "sites"."page_title")), lower(?)) > 0 OR instr("sites"."public_name", lower(?)) > 0)';
      const earlier = `select "earlier_ids"."id" from "earlier_ids" inner join "sites" on "sites"."folder" = "earlier_ids"."folder" where ${holds}`;
      const about = `(instr("audit"."site_name", lower(?)) > 0 OR "audit"."site_id" IN (select "id" from "sites" where ${holds}) OR "audit"."site_id" IN (${earlier}))`;
      const newest = '(SELECT max("audit"."seq") FROM "audit")';
      const newestKept = '(select "seq", "audit"."action" in (?) as "kept" from "audit" order by "audit"."seq" desc limit ?) "newest"';
      const page = 'select "seq", "at", "actor", "action", "site_id", "site_name", "detail" from "audit" where';
      const bySite = [
        `SELECT coalesce(${newest} - ? < (SELECT min("audit"."seq") FROM "audit"), 1) AS whole, (select count(*) as "found" from "audit" where ("audit"."seq" > ${newest} - ? and "audit"."action" in (?) and ${about})) AS found`,
        `${page} ("audit"."seq" < (SELECT max("audit"."seq") + 1 FROM "audit") AND "audit"."seq" >= (SELECT max("audit"."seq") + 1 FROM "audit") - ? and "audit"."action" in (?) and ${about}) order by "audit"."seq" desc limit ?`,
        `${page} ("audit"."seq" > ? AND "audit"."seq" <= ? + ? and ${about}) order by "audit"."seq" asc limit ?`,
      ];
      const counted = `select coalesce(min("newest"."seq") <= (SELECT min("audit"."seq") FROM "audit"), 1) as "whole", coalesce(sum("kept"), 0) as "found" from ${newestKept}`;
      const readOnce = (statement: string): string[] => [`SCAN sites <- ${statement}`, `SCAN earlier_ids USING COVERING INDEX earlier_ids_by_folder <- ${statement}`];
      const tokenScan = 'SCAN tokens USING INDEX tokens_by_creation <- select "id", "hash", "scope", "note", "created_at", "expires_at" from "tokens"';
      const newestFirst = 'order by "tokens"."created_at" desc, "tokens"."id" desc';
      expect([exported.sites, imported.kind, again.kind, redeemed.kind, swept]).toEqual([[], "done", "done", "done", 1]);
      expect(driver.statements.length).toBeGreaterThan(105);
      expect(scans).toEqual([
        `${tokenScan} where "tokens"."removed_at" is null ${newestFirst}`,
        `${tokenScan} where ("tokens"."removed_at" is null and ("tokens"."expires_at" is null or "tokens"."expires_at" > ?)) ${newestFirst}`,
        `SCAN audit <- ${counted}`,
        `SCAN newest <- ${counted}`,
        ...bySite.flatMap(readOnce),
        'SCAN logins USING INDEX logins_by_visitor <- delete from "logins" where "logins"."expires_at" <= ?',
        "SCAN schema_steps <- SELECT * FROM schema_steps ORDER BY step",
      ]);
    });
  });
}

function auditWindow(label: string, makeDriver: DriverFactory): void {
  describe(`${label}: a narrowed reading of a log longer than its window`, () => {
    // Drift: a narrowed page that read on until it was full would walk the whole log for a rare site, a row charged for each entry; one that stopped without saying so would show the log as ended where it only stopped looking.
    test("looks at one window from where it starts, says where it stopped while the log goes on, and finds the rest from there", async () => {
      const driver = await migrated(makeDriver);
      const database = new SqlDatabase(driver);
      await rows(driver, LONG_LOG);
      const told = async (query: Parameters<Database["searchAudit"]>[0]): Promise<unknown> => {
        const { entries, stoppedAt } = await database.searchAudit(query);

        return [entries.map((entry) => entry.site?.name ?? entry.action), stoppedAt];
      };

      expect([
        await told({ limit: 2, site: "o" }),
        await told({ limit: 2, site: "o", after: 8 }),
        await told({ limit: 2, site: "o", dir: "asc" }),
        await told({ limit: 2, site: "o", dir: "asc", after: AUDIT_WINDOW }),
        await told({ limit: 1, site: "o" }),
        await told({ limit: 2, actions: ["login"] }),
        await told({ limit: 2, site: "nowhere", after: 9 }),
      ]).toEqual([
        [["docs"], 8],
        [["report"], undefined],
        [["report"], AUDIT_WINDOW],
        [["docs"], undefined],
        [["docs"], undefined],
        [["login", "login"], undefined],
        [[], undefined],
      ]);
    });
  });
}

function requestCountRows(label: string, makeDriver: DriverFactory): void {
  describe(`${label}: the rows of the day's request counts`, () => {
    // Drift: the table is meant to hold a year; rows of earlier days left behind would grow it by a row per site every day.
    test("the table holds the newest year alone: a row per day and counted site with its views, and one under the empty site for all of them", async () => {
      const driver = await migrated(makeDriver);
      const database = new SqlDatabase(driver);
      await database.addRequests({ day: "2025-11-14", site: NO_SITE, requests: 9, views: 9 });
      await database.addRequests({ day: TODAY, site: NO_SITE, requests: 50, views: 20 });
      await database.addRequests({ day: TODAY, site: OTHER_SITE, requests: 1 });
      await database.addRequests({ day: TOMORROW, site: OTHER_SITE, requests: 2, views: 2 });

      expect(await rows(driver, "SELECT day, site, requests, views FROM request_counts ORDER BY day, site")).toEqual([
        { day: TODAY, site: "", requests: 51, views: 20 },
        { day: TODAY, site: OTHER_SITE, requests: 1, views: 0 },
        { day: TODAY, site: NO_SITE, requests: 50, views: 20 },
        { day: TOMORROW, site: "", requests: 2, views: 2 },
        { day: TOMORROW, site: OTHER_SITE, requests: 2, views: 2 },
      ]);
    });

    // Drift: D1 limits rows read and written a day; a count that walked the table would cost a row per site on every counted request.
    test("counting and reading go through the key: no statement walks the table", async () => {
      const inner = await migrated(makeDriver);
      const driver = new RecordingDriver(inner);
      const database = new SqlDatabase(driver);
      await database.addRequests({ day: TODAY, site: NO_SITE, requests: 1 });
      await database.readRequests(TODAY, NO_SITE);
      await database.readViews([NO_SITE, OTHER_SITE], TODAY);
      await database.readDailyViews([NO_SITE, OTHER_SITE], TODAY, 365);
      const scans: string[] = [];

      for (const statement of driver.statements) {
        const plan = await rows(inner, `EXPLAIN QUERY PLAN ${statement.sql}`, ...statement.params);
        // The lists of days and sites a read of views is given are walked, as they must be: they are its arguments, not the table.
        scans.push(...plan.map((step) => String(step.detail)).filter((step) => /\bSCAN\b/.test(step) && !step.includes("VIRTUAL TABLE")));
      }

      expect([driver.statements.length, scans]).toEqual([7, []]);
    });
  });
}

function manifestRows(label: string, makeDriver: DriverFactory): void {
  describe(`${label}: the row of an upload's manifest`, () => {
    // Drift: a request for a file runs once per file of a publish, and a database counts every entry of a manifest it walks as a row read; a lookup that walked the manifest would read as many rows as the publish has files, squared.
    test.each([3, 5000])("an upload of %d files is recorded in four statements, its whole manifest is read in one, and one file of it in one that walks nothing but the upload's key", async (files) => {
      const inner = await migrated(makeDriver);
      const driver = new RecordingDriver(inner);
      const database = new SqlDatabase(driver);
      const upload = await begunFiles(database, numberedFiles(files));
      const recorded = driver.statements.length;
      const whole = await database.getUpload(upload);
      const read = await database.getUploadFile(upload, "page-2.html");
      const lookup = driver.statements.at(-1);
      const plan = await rows(inner, `EXPLAIN QUERY PLAN ${lookup?.sql}`, ...(lookup?.params ?? []));

      expect([recorded, driver.statements.length - recorded, read?.file, whole?.manifest.length]).toEqual([4, 2, { path: "page-2.html", size: 2, content_type: "text/html" }, files]);
      expect(plan.map((step) => String(step.detail).split(" ")[0])).toEqual(["SEARCH"]);
    });

    // Drift: the manifest is written as text without an object ever being built, and a file is read as the one value under its key.
    // A text that escaped a path its own way or split two paths of one key would hide a file, and other key order is no longer the stored form.
    test.each(AWKWARD_MANIFESTS)("a manifest of %s is stored as the text the plain builder writes, and reads back whole and file by file", async (_name, paths) => {
      const driver = await migrated(makeDriver);
      const database = new SqlDatabase(driver);
      const manifest = paths.map((path, index) => ({ path, size: index * 1_000_003, content_type: index % 3 === 0 ? "text/html" : `text/x-${index}; charset="utf-8"; note=a",[[` }));
      const upload = await begunFiles(database, manifest);
      const [stored] = await rows(driver, "SELECT manifest FROM uploads WHERE id = ?1", upload);
      const each = await Promise.all(paths.map(async (path) => (await database.getUploadFile(upload, path))?.file));

      expect([stored?.manifest, (await database.getUpload(upload))?.manifest, each]).toEqual([plainManifestText(manifest), manifest, manifest]);
    });

    // Drift: the cap on a manifest is measured on its list, and a database refuses a value of 2,000,000 bytes; a stored form longer than the list would be refused for a manifest the cap let through.
    test.each([
      [1600, 850],
      [10_000, 65],
    ])("a manifest of %d files near the cap is stored in fewer bytes than its list, reads back whole, and is one text until the upload is given up", async (files, length) => {
      const driver = await migrated(makeDriver);
      const database = new SqlDatabase(driver);
      const manifest = numberedFiles(files).map((file) => ({ ...file, path: `${"p".repeat(length)}/${file.path}`, content_type: 'text/html; charset="utf-8"' }));
      const listed = new TextEncoder().encode(JSON.stringify(manifest)).length;
      const upload = await begunFiles(database, manifest);
      const held = async (): Promise<unknown> => (await rows(driver, "SELECT typeof(manifest) AS kind, length(CAST(manifest AS BLOB)) AS bytes FROM uploads WHERE id = ?1", upload))[0];
      const [kind, bytes] = Object.values((await held()) as object) as [string, number];
      const whole = await database.getUpload(upload);
      await database.abandonUpload(upload);

      expect([listed > 1_400_000 && listed <= 1_500_000, kind, bytes < listed, bytes > listed / 2]).toEqual([true, "text", true, true]);
      expect([whole?.manifest.length, whole?.manifest.at(-1), await held()]).toEqual([files, manifest.at(-1), { kind: "text", bytes: 2 }]);
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
  auditWindow(label, makeDriver);
  requestCountRows(label, makeDriver);
  manifestRows(label, makeDriver);
}

