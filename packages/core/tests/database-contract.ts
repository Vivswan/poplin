// The contract the database keeps over any SQL driver, as test cases that take a driver factory. Importing this file registers nothing.

import { describe, expect, test } from "bun:test";

import type { Login } from "../src/auth/logins";
import { mintToken, type TokenId } from "../src/auth/tokens";
import type { Database, NewSite, Signed } from "../src/database/database";
import type { SqlDriver, SqlValue, Statement, StatementResult } from "../src/database/driver";
import { openDatabase } from "../src/database/open";
import { SqlDatabase } from "../src/database/sql-database";
import { migrate, type Step, storedVersion } from "../src/migrations/migrate";
import { SCHEMA_VERSION, STEPS } from "../src/migrations/registry";
import type { PublicName, SiteName } from "../src/names/names";
import { defaultSettings } from "../src/records/settings";
import { mintSiteFolder, type Site } from "../src/records/site";
import type { SiteId } from "../src/sites/ids";

const NOW = 1_700_000_000_000;
const ADA = "00000000000000aa" as TokenId;
const BO = "00000000000000bb" as TokenId;
const BY_ADA: Signed = { by: ADA, at: NOW };
const REPORT = "report" as SiteName;
const DOCS = "docs" as PublicName;
const NO_SITE = "zzzzzzzzzzzz" as SiteId;
const SETTINGS = defaultSettings({ installer: "ada@example.com" as Login, hostname: "admin.example.com" });

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

async function rows(driver: SqlDriver, sql: string, ...params: SqlValue[]): Promise<readonly Readonly<Record<string, unknown>>[]> {
  const [result] = await driver.batch([{ sql, params }]);

  return result?.rows ?? [];
}

async function migrated(makeDriver: DriverFactory): Promise<SqlDriver> {
  const driver = await makeDriver();
  await migrate(driver, STEPS, NOW);

  return driver;
}

/** Site ids handed out in order, so a test knows the id a site gets and can make two candidates collide. */
function mintFrom(...ids: string[]): () => SiteId {
  const left = [...ids];

  return () => {
    const next = left.shift();
    if (next === undefined) throw new Error("the fixture ran out of site ids");

    return next as SiteId;
  };
}

function draft(name: SiteName, access: NewSite["access"] = "private", publicName: PublicName = name as PublicName): NewSite {
  const fields = { name, folder: mintSiteFolder(), title: null, search_engines: false, expires: "never" as const };
  if (access === "public") return { ...fields, access, public_name: publicName };

  return { ...fields, access };
}

async function made(database: Database, site: NewSite, signed: Signed = BY_ADA): Promise<Site> {
  const created = await database.createSite(site, signed);
  if (created.kind !== "done") throw new Error(`the fixture site was refused: ${created.kind}`);

  return created.site;
}

async function auditActions(driver: SqlDriver): Promise<unknown[]> {
  return (await rows(driver, "SELECT action FROM audit ORDER BY seq")).map((row) => row.action);
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
      expect(failed.kind === "failed" ? failed.message : "").toContain('Run "poplin doctor --fix" to try again');
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
        [{ sql: "INSERT INTO versions (folder, number, published_at, published_by) VALUES ('folder-of-no-site', 1, 0, ?1)", params: [ADA] }],
      ],
      ["a site moved to another folder", [{ sql: "UPDATE sites SET folder = 'folder-c' WHERE id = 'aaaaaaaaaaaa'", params: [] }]],
      ["an admin token that never expires", [{ sql: "INSERT INTO tokens (id, hash, scope, note, created_at) VALUES ('t', 'h', 'admin', '', 0)", params: [] }]],
      [
        "a publisher token that expires",
        [{ sql: "INSERT INTO tokens (id, hash, scope, note, created_at, expires_at) VALUES ('t', 'h', 'publisher', '', 0, 1)", params: [] }],
      ],
      ["a second row of settings", [{ sql: "INSERT INTO settings (id, value, updated_at) VALUES (2, '{}', 0)", params: [] }]],
      ["an audit entry rewritten", [{ sql: "UPDATE audit SET actor = 'someone' WHERE seq = 1", params: [] }]],
      ["an audit entry removed", [{ sql: "DELETE FROM audit WHERE seq = 1", params: [] }]],
    ] as ReadonlyArray<readonly [string, readonly Statement[]]>)("refuses %s", async (_state, statements) => {
      const driver = await migrated(makeDriver);
      await driver.batch([stored, { sql: "INSERT INTO audit (at, actor, action, detail) VALUES (0, ?1, 'login', '{}')", params: [ADA] }]);

      await expect(driver.batch(statements)).rejects.toThrow();
    });
  });
}

function sites(label: string, makeDriver: DriverFactory): void {
  describe(`${label}: sites`, () => {
    // Drift: a name is a label and the id is the key; a unique name would refuse the second "report" anyone publishes.
    test("two sites with one name coexist under different ids, each found by its own id alone", async () => {
      const database = new SqlDatabase(await migrated(makeDriver));
      const first = await made(database, draft(REPORT));
      const second = await made(database, draft(REPORT));

      expect([first.name, second.name, first.id === second.id]).toEqual([REPORT, REPORT, false]);
      expect([await database.getSite(first.id), await database.getSite(second.id)]).toEqual([first, second]);
      expect(first).toEqual({
        id: first.id,
        name: REPORT,
        folder: first.folder,
        title: null,
        search_engines: false,
        embeddable: true,
        expires: "never",
        live_version: 1,
        versions: [{ number: 1, published_at: NOW, published_by: ADA }],
        owner: ADA,
        created_at: NOW,
        updated_at: NOW,
        access: "private",
        state: "live",
      });
    });

    // Drift: an id that is taken, as an id or as a public name, must cost a second draw and never a failed publish or a shadowed address.
    test("a candidate id that is a site's id or a site's public name is drawn again, for a new site and for a new id", async () => {
      const driver = await migrated(makeDriver);
      const database = new SqlDatabase(
        driver,
        mintFrom("aaaaaaaaaaaa", "aaaaaaaaaaaa", "bbbbbbbbbbbb", "cccccccccccc", "aaaaaaaaaaaa", "cccccccccccc", "dddddddddddd", "eeeeeeeeeeee"),
      );
      const first = await made(database, draft(REPORT));
      const second = await made(database, draft(REPORT, "public", "cccccccccccc" as PublicName));
      const third = await made(database, draft(DOCS));
      const moved = await database.giveNewId(third.id, BY_ADA);

      expect<unknown>([first.id, second.id, third.id, moved.kind === "done" ? moved.site.id : moved.kind]).toEqual([
        "aaaaaaaaaaaa",
        "bbbbbbbbbbbb",
        "dddddddddddd",
        "eeeeeeeeeeee",
      ]);
      expect(await auditActions(driver)).toEqual(["create", "create", "create", "new_id"]);
    });

    // Drift: a public name is an address; two holders, or a name that reads as some site's id, would send a visitor to the wrong site.
    test.each([
      [
        "a new public site, the name held by another site",
        async (database: Database): Promise<unknown> => database.createSite(draft(REPORT, "public", DOCS), BY_ADA),
      ],
      [
        "a new public site, the name being another site's id",
        async (database: Database, holder: Site): Promise<unknown> => database.createSite(draft(REPORT, "public", holder.id as string as PublicName), BY_ADA),
      ],
      [
        "a site going public, the name held by another site",
        async (database: Database): Promise<unknown> =>
          database.changeAccess((await made(database, draft(REPORT))).id, { access: "public", public_name: DOCS }, BY_ADA),
      ],
      [
        "a site going public, the name being another site's id",
        async (database: Database, holder: Site): Promise<unknown> =>
          database.changeAccess((await made(database, draft(REPORT))).id, { access: "public", public_name: holder.id as string as PublicName }, BY_ADA),
      ],
      [
        "a site going public under its own id",
        async (database: Database): Promise<unknown> => {
          const site = await made(database, draft(REPORT));

          return database.changeAccess(site.id, { access: "public", public_name: site.id as string as PublicName }, BY_ADA);
        },
      ],
      [
        "a public site changing its name to one that is held",
        async (database: Database): Promise<unknown> =>
          database.changeAccess((await made(database, draft(REPORT, "public"))).id, { access: "public", public_name: DOCS }, BY_ADA),
      ],
    ] as const)("refuses %s with name_taken and writes no audit entry", async (_case, claim) => {
      const driver = await migrated(makeDriver);
      const database = new SqlDatabase(driver);
      const holder = await made(database, draft(DOCS, "public"));
      const refused = await claim(database, holder);
      const actions = await auditActions(driver);

      expect(refused).toEqual({ kind: "name_taken" });
      expect(actions.filter((action) => action !== "create")).toEqual([]);
      expect(await database.getSiteByPublicName(DOCS)).toEqual(holder);
    });

    // Drift: read-then-write would let both callers see the name free; the claim is one conditional statement, so the database decides.
    test("two claims of one public name at the same moment leave exactly one holder, and the loser gets name_taken", async () => {
      const driver = await migrated(makeDriver);
      const database = new SqlDatabase(driver);
      const [first, second] = [await made(database, draft(REPORT)), await made(database, draft(REPORT))];
      const claims = await Promise.all([first, second].map((site) => database.changeAccess(site.id, { access: "public", public_name: DOCS }, BY_ADA)));
      const holders = await rows(driver, "SELECT id FROM sites WHERE public_name = ?1", DOCS);

      expect(claims.map((claim) => claim.kind).sort()).toEqual(["done", "name_taken"]);
      expect(holders).toHaveLength(1);
      expect((await auditActions(driver)).filter((action) => action === "access")).toHaveLength(1);
      expect(
        [...claims, ...(await Promise.all([database.createSite(draft(DOCS, "public"), BY_ADA), database.createSite(draft(DOCS, "public"), BY_ADA)]))]
          .map((claim) => claim.kind)
          .sort(),
      ).toEqual(["done", "name_taken", "name_taken", "name_taken"]);
    });

    test("access moves between the three, a public name is claimed, changed, and freed, and asking for what already is writes nothing", async () => {
      const driver = await migrated(makeDriver);
      const database = new SqlDatabase(driver);
      const site = await made(database, draft(REPORT));
      const later: Signed = { by: BO, at: NOW + 5 };
      const steps = [
        await database.changeAccess(site.id, { access: "unlisted" }, later),
        await database.changeAccess(site.id, { access: "unlisted" }, later),
        await database.changeAccess(site.id, { access: "public", public_name: REPORT as PublicName }, later),
        await database.changeAccess(site.id, { access: "public", public_name: DOCS }, later),
        await database.changeAccess(site.id, { access: "public", public_name: DOCS }, later),
        await database.changeAccess(site.id, { access: "private" }, later),
      ];

      expect<unknown>(
        steps.map((step) =>
          "site" in step ? [step.kind, step.site.access, "public_name" in step.site ? step.site.public_name : null, step.site.updated_at] : step.kind,
        ),
      ).toEqual([
        ["done", "unlisted", null, NOW + 5],
        ["unchanged", "unlisted", null, NOW + 5],
        ["done", "public", REPORT, NOW + 5],
        ["done", "public", DOCS, NOW + 5],
        ["unchanged", "public", DOCS, NOW + 5],
        ["done", "private", null, NOW + 5],
      ]);
      expect(await rows(driver, "SELECT action, actor, site_id, site_name, detail FROM audit WHERE action = 'access' ORDER BY seq")).toEqual([
        { action: "access", actor: BO, site_id: site.id, site_name: REPORT, detail: '{"access":"unlisted","public_name":null}' },
        { action: "access", actor: BO, site_id: site.id, site_name: REPORT, detail: '{"access":"public","public_name":"report"}' },
        { action: "access", actor: BO, site_id: site.id, site_name: REPORT, detail: '{"access":"public","public_name":"docs"}' },
        { action: "access", actor: BO, site_id: site.id, site_name: REPORT, detail: '{"access":"private","public_name":null}' },
      ]);
      expect([await database.getSiteByPublicName(DOCS), await database.getSiteByPublicName(REPORT as PublicName)]).toEqual([undefined, undefined]);
    });

    // Drift: "new link" exists to cut off everyone who holds the old address; an old id that still resolved would defeat it.
    test("after a new id the old id names no site, the public name leads to the new id, and the folder and versions are the same", async () => {
      const database = new SqlDatabase(await migrated(makeDriver));
      const site = await made(database, draft(REPORT, "public", DOCS));
      const moved = await database.giveNewId(site.id, { by: ADA, at: NOW + 9 });
      if (moved.kind !== "done") throw new Error(`the new id was refused: ${moved.kind}`);

      expect(moved.site).toEqual({ ...site, id: moved.site.id, updated_at: NOW + 9 });
      expect(moved.site.id).not.toBe(site.id);
      expect([await database.getSite(site.id), await database.findServed({ id: site.id }, NOW)]).toEqual([undefined, undefined]);
      expect([await database.getSiteByPublicName(DOCS), await database.findServed({ public_name: DOCS }, NOW), await database.getSite(moved.site.id)]).toEqual([
        moved.site,
        moved.site,
        moved.site,
      ]);
    });

    // Drift: the trash is an undo, so the site must come back whole, name included; and a trashed site must look exactly like no site to a visitor.
    test("a trashed site keeps its public name, is served at neither address, and comes back whole when restored", async () => {
      const database = new SqlDatabase(await migrated(makeDriver));
      const site = await made(database, draft(REPORT, "public", DOCS));
      const trashed = await database.trashSite(site.id, { by: ADA, at: NOW + 1 });
      const inTrash = { ...site, updated_at: NOW + 1, state: "trash", trashed_at: NOW + 1 };

      expect(trashed).toEqual({ kind: "done", site: inTrash } as typeof trashed);
      expect([await database.findServed({ id: site.id }, NOW), await database.findServed({ public_name: DOCS }, NOW)]).toEqual([undefined, undefined]);
      expect<unknown>([await database.getSite(site.id), await database.getSiteByPublicName(DOCS)]).toEqual([inTrash, inTrash]);
      expect(await database.createSite(draft(DOCS, "public"), BY_ADA)).toEqual({ kind: "name_taken" });
      expect(await database.restoreSite(site.id, { by: ADA, at: NOW + 2 })).toEqual({ kind: "done", site: { ...site, updated_at: NOW + 2 } });
      expect(await database.findServed({ public_name: DOCS }, NOW)).toEqual({ ...site, updated_at: NOW + 2 });
    });

    // Drift: a name held by a row that no longer exists could never be claimed again.
    test("deleting a site for good frees its public name and removes its versions with it", async () => {
      const driver = await migrated(makeDriver);
      const database = new SqlDatabase(driver);
      const site = await made(database, draft(REPORT, "public", DOCS));
      await database.trashSite(site.id, BY_ADA);
      const trashed = await database.getSite(site.id);
      const deleted = await database.deleteSite(site.id, BY_ADA);

      expect(deleted).toEqual({ kind: "done", site: trashed } as typeof deleted);
      expect([await database.getSite(site.id), await database.getSiteByPublicName(DOCS)]).toEqual([undefined, undefined]);
      expect(await rows(driver, "SELECT * FROM versions")).toEqual([]);
      expect((await database.createSite(draft(DOCS, "public"), BY_ADA)).kind).toBe("done");
    });

    test.each([
      ["never", NOW, true],
      [NOW + 1, NOW, true],
      [NOW, NOW, false],
      [NOW - 1, NOW, false],
    ] as const)("a site expiring at %j is served at %j: %j", async (expires, now, served) => {
      const database = new SqlDatabase(await migrated(makeDriver));
      const site = await made(database, { ...draft(REPORT), expires });

      expect((await database.findServed({ id: site.id }, now)) !== undefined).toBe(served);
      expect((await database.getSite(site.id))?.expires).toBe(expires);
    });

    test("details change only where a given value differs, and a trashed or missing site is refused", async () => {
      const driver = await migrated(makeDriver);
      const database = new SqlDatabase(driver);
      const site = await made(database, draft(REPORT));
      const later: Signed = { by: ADA, at: NOW + 3 };
      const changed = { ...site, title: "Q3 report", search_engines: true, expires: NOW + 100, updated_at: NOW + 3 };

      expect(await database.changeDetails(site.id, { title: "Q3 report", search_engines: true, expires: NOW + 100 }, later)).toEqual({
        kind: "done",
        site: changed,
      });
      expect(await database.changeDetails(site.id, { title: "Q3 report" }, { by: ADA, at: NOW + 4 })).toEqual({ kind: "unchanged", site: changed });
      expect(await database.changeDetails(site.id, {}, { by: ADA, at: NOW + 4 })).toEqual({ kind: "unchanged", site: changed });
      expect(await database.changeDetails(site.id, { title: null, expires: "never" }, later)).toEqual({
        kind: "done",
        site: { ...changed, title: null, expires: "never" },
      });
      expect(await database.changeDetails(NO_SITE, { title: "x" }, later)).toEqual({ kind: "not_found" });
      await expect(database.changeDetails(site.id, { title: "" }, later)).rejects.toThrow();
      expect((await auditActions(driver)).filter((action) => action === "details")).toHaveLength(2);
    });

    // Drift: the serving code forbids framing from this flag alone; a site made without it, or a change that did not stick, would open or seal the wrong site.
    test("a site is embeddable unless made otherwise, and the flag is set to false and back with one audit entry each", async () => {
      const driver = await migrated(makeDriver);
      const database = new SqlDatabase(driver);
      const site = await made(database, draft(REPORT));
      const sealed = await made(database, { ...draft(REPORT), embeddable: false });
      const flags = [
        await database.changeDetails(site.id, { embeddable: false }, BY_ADA),
        await database.changeDetails(site.id, { embeddable: false }, BY_ADA),
        await database.changeDetails(site.id, { embeddable: true }, BY_ADA),
      ];

      expect([site.embeddable, sealed.embeddable]).toEqual([true, false]);
      expect(flags.map((flag) => ("site" in flag ? [flag.kind, flag.site.embeddable] : flag.kind))).toEqual([
        ["done", false],
        ["unchanged", false],
        ["done", true],
      ]);
      expect(await rows(driver, "SELECT detail FROM audit WHERE action = 'details' ORDER BY seq")).toEqual([
        { detail: '{"embeddable":false}' },
        { detail: '{"embeddable":true}' },
      ]);
      expect((await database.getSite(site.id))?.embeddable).toBe(true);
    });

    // Drift: the dashboard pages through this; a page that skipped or repeated a site, or mixed the trash in, would hide or double sites.
    test("a listing pages through the sites newest change first, apart from the trash, and by owner when asked", async () => {
      const database = new SqlDatabase(await migrated(makeDriver), mintFrom("aaaaaaaaaaaa", "bbbbbbbbbbbb", "cccccccccccc", "dddddddddddd", "eeeeeeeeeeee"));
      const ids: SiteId[] = [];
      for (const [by, at] of [
        [ADA, NOW],
        [BO, NOW],
        [ADA, NOW + 1],
        [BO, NOW + 2],
        [ADA, NOW + 3],
      ] as const)
        ids.push((await made(database, draft(REPORT), { by, at })).id);
      await database.trashSite("dddddddddddd" as SiteId, { by: ADA, at: NOW + 9 });

      const first = await database.listSites({ trash: false, limit: 3 });
      const second = await database.listSites({ trash: false, limit: 3, ...(first.next === undefined ? {} : { after: first.next }) });
      const page = (listed: { readonly sites: readonly Site[] }): string[] => listed.sites.map((site) => site.id);

      expect<unknown>([page(first), first.next, page(second), second.next]).toEqual([
        ["eeeeeeeeeeee", "cccccccccccc", "bbbbbbbbbbbb"],
        { updated_at: NOW, id: "bbbbbbbbbbbb" },
        ["aaaaaaaaaaaa"],
        undefined,
      ]);
      expect(page(await database.listSites({ trash: true, limit: 100 }))).toEqual(["dddddddddddd"]);
      expect(page(await database.listSites({ trash: false, owner: BO, limit: 100 }))).toEqual(["bbbbbbbbbbbb"]);
      expect(page(await database.listSites({ trash: true, owner: ADA, limit: 100 }))).toEqual([]);
      expect(ids).toHaveLength(5);
      await expect(database.listSites({ trash: false, limit: 0 })).rejects.toThrow(RangeError);
      await expect(database.listSites({ trash: false, limit: 101 })).rejects.toThrow(RangeError);
    });
  });
}

function versions(label: string, makeDriver: DriverFactory): void {
  describe(`${label}: versions`, () => {
    // Drift: two publishes to one site upload into the folder of their version number; one number handed out twice would mix their files.
    test("version numbers reserved at the same moment are all different, and a publish goes live under its number while old versions are dropped", async () => {
      const driver = await migrated(makeDriver);
      const database = new SqlDatabase(driver);
      const site = await made(database, draft(REPORT));
      const reserved = await Promise.all([1, 2, 3].map(() => database.reserveVersion(site.id)));
      const numbers = reserved.map((answer) => (answer.kind === "reserved" ? answer.number : 0)).sort();
      const second = await database.addVersion(site.id, { number: 2, keep: 3 }, { by: BO, at: NOW + 2 });
      const fourth = await database.addVersion(site.id, { number: 4, keep: 2 }, { by: BO, at: NOW + 4 });

      expect(numbers).toEqual([2, 3, 4]);
      expect(second).toMatchObject({
        kind: "done",
        dropped: [],
        site: { live_version: 2, updated_at: NOW + 2, versions: [{ number: 1 }, { number: 2, published_at: NOW + 2, published_by: BO }] },
      });
      expect(fourth).toMatchObject({ kind: "done", dropped: [1], site: { live_version: 4, versions: [{ number: 2 }, { number: 4 }] } });
      expect(await database.addVersion(site.id, { number: 3, keep: 2 }, BY_ADA)).toEqual({ kind: "stale_number" });
      expect(await database.addVersion(site.id, { number: 5, keep: 2 }, BY_ADA)).toEqual({ kind: "stale_number" });
      expect(await database.addVersion(NO_SITE, { number: 2, keep: 2 }, BY_ADA)).toEqual({ kind: "not_found" });
      await expect(database.addVersion(site.id, { number: 5, keep: 0 }, BY_ADA)).rejects.toThrow(RangeError);
      expect(await auditActions(driver)).toEqual(["create", "publish", "publish"]);
    });

    // Drift: "go back one" decided from an earlier read would send two rollbacks to the same version; here each one moves from where the site is.
    test("the live version moves to a kept number or to the one before, and never to a version that is not kept", async () => {
      const driver = await migrated(makeDriver);
      const database = new SqlDatabase(driver);
      const site = await made(database, draft(REPORT));
      for (const number of [2, 3]) {
        await database.reserveVersion(site.id);
        await database.addVersion(site.id, { number, keep: 3 }, BY_ADA);
      }

      const moves = [
        await database.setLiveVersion(site.id, "previous", BY_ADA),
        await database.setLiveVersion(site.id, "previous", BY_ADA),
        await database.setLiveVersion(site.id, "previous", BY_ADA),
        await database.setLiveVersion(site.id, 3, BY_ADA),
        await database.setLiveVersion(site.id, 3, BY_ADA),
        await database.setLiveVersion(site.id, 7, BY_ADA),
        await database.setLiveVersion(NO_SITE, 1, BY_ADA),
      ];

      expect(moves.map((move) => ("site" in move ? [move.kind, move.site.live_version] : move.kind))).toEqual([
        ["done", 2],
        ["done", 1],
        "no_such_version",
        ["done", 3],
        ["unchanged", 3],
        "no_such_version",
        "not_found",
      ]);
      expect(await rows(driver, "SELECT detail FROM audit WHERE action = 'live_version' ORDER BY seq")).toEqual([
        { detail: '{"version":2}' },
        { detail: '{"version":1}' },
        { detail: '{"version":3}' },
      ]);
    });
  });
}

function auditLog(label: string, makeDriver: DriverFactory): void {
  describe(`${label}: the audit log`, () => {
    const signed: Signed = { by: BO, at: NOW + 1 };

    // Drift: the Activity tab is only as true as this; a change with no entry, or an entry for a change that was refused, makes it lie.
    test.each([
      ["a site made", async (database: Database): Promise<unknown> => database.createSite(draft(DOCS), signed), ["create"]],
      [
        "access changed",
        async (database: Database, site: Site): Promise<unknown> => database.changeAccess(site.id, { access: "unlisted" }, signed),
        ["access"],
      ],
      ["details changed", async (database: Database, site: Site): Promise<unknown> => database.changeDetails(site.id, { title: "T" }, signed), ["details"]],
      ["a new id given", async (database: Database, site: Site): Promise<unknown> => database.giveNewId(site.id, signed), ["new_id"]],
      ["a site trashed", async (database: Database, site: Site): Promise<unknown> => database.trashSite(site.id, signed), ["trash"]],
      ["a site restored", async (database: Database, _site: Site, trashed: Site): Promise<unknown> => database.restoreSite(trashed.id, signed), ["restore"]],
      ["a site deleted", async (database: Database, site: Site): Promise<unknown> => database.deleteSite(site.id, signed), ["delete"]],
      [
        "a version reserved and published",
        async (database: Database, site: Site): Promise<unknown> => [
          await database.reserveVersion(site.id),
          await database.addVersion(site.id, { number: 2, keep: 3 }, signed),
        ],
        ["publish"],
      ],
      [
        "a token added",
        async (database: Database): Promise<unknown> => database.addToken((await mintToken({ scope: "publisher", note: "ci", now: NOW })).record, signed),
        ["token_added"],
      ],
      ["settings changed", async (database: Database): Promise<unknown> => database.changeSettings({ trash_days: 30 }, signed), ["settings_changed"]],
      ["a note appended", async (database: Database): Promise<unknown> => database.appendAudit({ action: "login", detail: {} }, signed), ["login"]],
      [
        "access set to what it is",
        async (database: Database, site: Site): Promise<unknown> => database.changeAccess(site.id, { access: "private" }, signed),
        [],
      ],
      [
        "access changed on a trashed site",
        async (database: Database, _site: Site, trashed: Site): Promise<unknown> => database.changeAccess(trashed.id, { access: "unlisted" }, signed),
        [],
      ],
      [
        "details changed on a trashed site",
        async (database: Database, _site: Site, trashed: Site): Promise<unknown> => database.changeDetails(trashed.id, { title: "T" }, signed),
        [],
      ],
      ["a new id for a trashed site", async (database: Database, _site: Site, trashed: Site): Promise<unknown> => database.giveNewId(trashed.id, signed), []],
      ["a new id for no site", async (database: Database): Promise<unknown> => database.giveNewId(NO_SITE, signed), []],
      ["a trashed site trashed again", async (database: Database, _site: Site, trashed: Site): Promise<unknown> => database.trashSite(trashed.id, signed), []],
      ["a live site restored", async (database: Database, site: Site): Promise<unknown> => database.restoreSite(site.id, signed), []],
      ["no site deleted", async (database: Database): Promise<unknown> => database.deleteSite(NO_SITE, signed), []],
      [
        "a version reserved for a trashed site",
        async (database: Database, _site: Site, trashed: Site): Promise<unknown> => database.reserveVersion(trashed.id),
        [],
      ],
      [
        "a version published to a trashed site",
        async (database: Database, _site: Site, trashed: Site): Promise<unknown> => database.addVersion(trashed.id, { number: 1, keep: 3 }, signed),
        [],
      ],
      [
        "an unreserved version published",
        async (database: Database, site: Site): Promise<unknown> => database.addVersion(site.id, { number: 2, keep: 3 }, signed),
        [],
      ],
      ["the live version set to what it is", async (database: Database, site: Site): Promise<unknown> => database.setLiveVersion(site.id, 1, signed), []],
      [
        "the live version moved on a trashed site",
        async (database: Database, _site: Site, trashed: Site): Promise<unknown> => database.setLiveVersion(trashed.id, "previous", signed),
        [],
      ],
      ["no token revoked", async (database: Database): Promise<unknown> => database.revokeToken(BO, signed), []],
      ["settings stored a second time", async (database: Database): Promise<unknown> => database.initSettings(SETTINGS, signed), []],
      ["no setting changed", async (database: Database): Promise<unknown> => database.changeSettings({}, signed), []],
      [
        "a setting set to what it is",
        async (database: Database): Promise<unknown> =>
          database.changeSettings({ trash_days: 7, cache_html: { count: 60, unit: "s" }, logins: SETTINGS.logins }, signed),
        [],
      ],
    ] as const)("%s writes exactly these entries: %#", async (_case, change, entries) => {
      const driver = await migrated(makeDriver);
      const database = new SqlDatabase(driver);
      const site = await made(database, draft(REPORT));
      const trashed = await made(database, draft(REPORT));
      await database.trashSite(trashed.id, BY_ADA);
      await database.initSettings(SETTINGS, BY_ADA);
      const before = (await auditActions(driver)).length;
      await change(database, site, trashed);

      expect((await auditActions(driver)).slice(before)).toEqual([...entries]);
    });

    test("entries read back newest first, a page at a time, each with who, when, and the site as it was named then", async () => {
      const database = new SqlDatabase(await migrated(makeDriver));
      const site = await made(database, draft(REPORT));
      await database.trashSite(site.id, { by: BO, at: NOW + 1 });
      await database.deleteSite(site.id, { by: BO, at: NOW + 2 });
      await database.appendAudit({ action: "login", detail: { from: "dashboard" } }, { by: "ada@example.com" as Login, at: NOW + 3 });
      const named = { id: site.id, name: REPORT };
      const newest = await database.listAudit({ limit: 2 });

      expect(newest).toEqual([
        { seq: 4, at: NOW + 3, by: "ada@example.com" as Login, action: "login", site: null, detail: { from: "dashboard" } },
        { seq: 3, at: NOW + 2, by: BO, action: "delete", site: named, detail: {} },
      ]);
      expect(await database.listAudit({ limit: 100, before: 3 })).toEqual([
        { seq: 2, at: NOW + 1, by: BO, action: "trash", site: named, detail: {} },
        { seq: 1, at: NOW, by: ADA, action: "create", site: named, detail: { access: "private", public_name: null } },
      ]);
      await expect(database.listAudit({ limit: 0 })).rejects.toThrow(RangeError);
    });
  });
}

function tokensAndSettings(label: string, makeDriver: DriverFactory): void {
  describe(`${label}: tokens and settings`, () => {
    // Drift: the record `mintToken` makes is what a presented token is checked against; a field lost on the way through a row would refuse every token.
    test("a minted token's record reads back as minted, lists newest first, and is gone once revoked", async () => {
      const driver = await migrated(makeDriver);
      const database = new SqlDatabase(driver);
      const admin = (await mintToken({ scope: "admin", note: "laptop", now: NOW })).record;
      const publisher = (await mintToken({ scope: "publisher", note: "", now: NOW + 1 })).record;

      expect([await database.addToken(admin, BY_ADA), await database.addToken(publisher, BY_ADA), await database.addToken(admin, BY_ADA)]).toEqual([
        { kind: "done" },
        { kind: "done" },
        { kind: "id_taken" },
      ]);
      expect([await database.getToken(admin.id), await database.getToken(publisher.id), await database.getToken(BO)]).toEqual([admin, publisher, undefined]);
      expect(await database.listTokens()).toEqual([publisher, admin]);
      expect([await database.revokeToken(admin.id, BY_ADA), await database.revokeToken(admin.id, BY_ADA)]).toEqual([
        { kind: "done", token: admin },
        { kind: "not_found" },
      ]);
      expect(await database.listTokens()).toEqual([publisher]);
      expect(await rows(driver, "SELECT action, detail FROM audit ORDER BY seq")).toEqual([
        { action: "token_added", detail: JSON.stringify({ token: admin.id, scope: "admin", note: "laptop" }) },
        { action: "token_added", detail: JSON.stringify({ token: publisher.id, scope: "publisher", note: "" }) },
        { action: "token_revoked", detail: JSON.stringify({ token: admin.id, scope: "admin", note: "laptop" }) },
      ]);
    });

    // Drift: two admins each changing one setting must both be heard; a whole-record write would let the second silently undo the first.
    test("settings are stored once, and two changes of different keys at the same moment both land", async () => {
      const database = new SqlDatabase(await migrated(makeDriver));

      expect([await database.readSettings(), await database.changeSettings({ trash_days: 30 }, BY_ADA)]).toEqual([undefined, { kind: "not_set_up" }]);
      expect(await database.initSettings(SETTINGS, BY_ADA)).toEqual({ kind: "done", values: SETTINGS });
      expect(await database.initSettings({ ...SETTINGS, trash_days: 99 }, BY_ADA)).toEqual({ kind: "already_set", values: SETTINGS });

      const cache = { count: 5, unit: "m" } as const;
      await Promise.all([
        database.changeSettings({ trash_days: 30, default_expires: { count: 7, unit: "d" } }, BY_ADA),
        database.changeSettings({ cache_html: cache, max_sites: 40 }, BY_ADA),
      ]);

      expect(await database.readSettings()).toEqual({
        ...SETTINGS,
        trash_days: 30,
        default_expires: { count: 7, unit: "d" },
        cache_html: cache,
        max_sites: 40,
      });
      expect(await database.changeSettings({ default_expires: "never", max_sites: "none" }, BY_ADA)).toEqual({
        kind: "done",
        values: { ...SETTINGS, trash_days: 30, cache_html: cache },
      });
      await expect(database.changeSettings({ trash_days: 0 }, BY_ADA)).rejects.toThrow();
      await expect(database.changeSettings({ logins: [] }, BY_ADA)).rejects.toThrow();
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
      await database.addVersion(site.id, { number: 2, keep: 3 }, BY_ADA);
      await database.setLiveVersion(site.id, "previous", BY_ADA);
      await database.setLiveVersion(site.id, 2, BY_ADA);
      const moved = await database.giveNewId(site.id, BY_ADA);
      const id = moved.kind === "done" ? moved.site.id : site.id;
      await database.trashSite(id, BY_ADA);
      await database.restoreSite(id, BY_ADA);
      await database.deleteSite(id, BY_ADA);
      await database.addToken(token, BY_ADA);
      await database.getToken(token.id);
      await database.listTokens();
      await database.revokeToken(token.id, BY_ADA);
      await database.readSettings();
      await database.changeSettings({ trash_days: 30 }, BY_ADA);
      await database.appendAudit({ action: "login", detail: {} }, BY_ADA);
      await database.listAudit({ limit: 10 });
      await storedVersion(driver);

      const scans: string[] = [];
      for (const statement of driver.statements) {
        const plan = await rows(inner, `EXPLAIN QUERY PLAN ${statement.sql}`, ...statement.params);
        const steps = plan.map((step) => String(step.detail));
        scans.push(
          ...steps
            .filter((step) => /\bSCAN\b/.test(step) && !/\bSCAN (CONSTANT ROW|sqlite_master)\b/.test(step))
            .map((step) => `${step} <- ${statement.sql.trim().split("\n")[0]}`),
        );
      }

      // The one walk is the token list, which hands back every row it reads.
      expect(driver.statements.length).toBeGreaterThan(60);
      expect(scans).toEqual([
        "SCAN tokens USING INDEX tokens_by_creation <- SELECT id, hash, scope, note, created_at, expires_at FROM tokens ORDER BY created_at DESC, id DESC",
      ]);
    });
  });
}

/**
 * Register the contract of the database over one SQL driver.
 *
 * @param makeDriver - gives a new, empty database on every call
 */
export function describeDatabase(label: string, makeDriver: DriverFactory): void {
  theDriver(label, makeDriver);
  migrations(label, makeDriver);
  schemaRules(label, makeDriver);
  sites(label, makeDriver);
  versions(label, makeDriver);
  auditLog(label, makeDriver);
  tokensAndSettings(label, makeDriver);
  queryPlans(label, makeDriver);
}
