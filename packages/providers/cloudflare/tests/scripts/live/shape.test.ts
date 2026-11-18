// The look at what stands of the test install runs against a local fake of the Cloudflare API whose database is a real SQLite.
// A schema step changed in place keeps its number: the Worker of the next commit met the database of the last one, and every address of the test install answered 503.

import { describe, expect, test } from "bun:test";

import { holdsOwnSchema, lastAsked, readStanding } from "../../../scripts/live/shape";
import { openRun } from "../../../scripts/live/util";
import { withFake } from "../../shared/install/support/fake-cloudflare";
import { type Asked, page, refusal, reply } from "../../shared/install/support/replies";
import type { Login } from "../../../../../core/src/auth/logins";
import { openDatabase } from "../../../../../core/src/database/open";
import { SqlDatabase } from "../../../../../core/src/database/sql-database";
import { defaultSettings } from "../../../../../core/src/records/settings";
import { BunSqliteDriver } from "../../../../../core/tests/database/support/bun-sqlite-driver";
import { catchStep } from "../../live/support/step";

/** The account the fake holds. */
const ACCOUNT = "0".repeat(32);

/** The database the account holds. */
const DATABASE = "database-1";

/** The moment the fake's database was made. */
const NOW = 1_700_000_000_000;

/** The admin whose settings the fake's install starts with. */
const INSTALLER = "ada@example.com" as Login;

/** Where the Worker's bindings and the account's databases are read. */
const [SETTINGS, DATABASES] = [`GET /accounts/${ACCOUNT}/workers/scripts/poplin/settings`, `GET /accounts/${ACCOUNT}/d1/database`];

/** What leaves a database this code made one schema step behind it. */
const BEHIND = "DELETE FROM schema_steps WHERE step = (SELECT max(step) FROM schema_steps)";

/** What makes a database's schema step one another build applied. */
const OF_ANOTHER_BUILD = "UPDATE schema_steps SET fingerprint = 'of another build'";

/** In place of a refused call: Cloudflare answers every query as not run. */
const NO_QUERY_RUNS = "no query runs";

/** What the fake account holds. */
interface Held {
  /** The bucket its Worker is bound to; `null` for no Worker. */
  readonly bucket?: string | null;

  /** Set where the Worker lacks the place of a finished install. */
  readonly unfinished?: true;

  /** SQL run on a database this code made; `null` leaves the database empty, and `undefined` is no database. */
  readonly drift?: string | null;
}

/** The bindings a finished install's Worker carries beside its bucket: where it answers, and its account. */
const FINISHED = [
  { name: "ZONE", type: "json", json: { domain: "example.com" } },
  { name: "ACCOUNT_ID", type: "plain_text", text: ACCOUNT },
];

/** One account, and what a run reads of it. */
type Case = readonly [what: string, held: Held, standing: unknown];

const CASES: readonly Case[] = [
  ["an account with no Worker and no database is one a run goes on with", { bucket: null }, { drift: undefined, current: false }],
  ["a database no step ran on is left for the Worker to fill", { drift: null }, { drift: undefined, current: false }],
  ["a database this code made, with its settings, is gone on with, and the build before still answers from it", { drift: "SELECT 1" }, { drift: undefined, current: true }],
  ["a database behind this commit by a step is left for the Worker to bring forward", { drift: BEHIND }, { drift: undefined, current: false }],
  [
    "a database whose settings lack a setting this code reads is another build's",
    { drift: "UPDATE settings SET value = json_remove(value, '$.max_storage_writes_per_day')" },
    { drift: "a database that held settings this commit does not read", current: false },
  ],
  ["a database whose schema step another build applied is another build's", { drift: OF_ANOTHER_BUILD }, { drift: "a database that held schema step 1 as another build applied it", current: false }],
  [
    "a database with a step this code does not have is another build's",
    { drift: "INSERT INTO schema_steps (step, version, name, description, applied_at, fingerprint) VALUES (999, '9.9.9', 'later', 'a step of a later commit', 0, 'later')" },
    { drift: "a database that held a schema step this commit does not have", current: false },
  ],
  ["a Worker bound to another bucket than the product's is another build's, whatever its database holds", { bucket: "a-bucket-of-another-name", drift: "SELECT 1" }, { drift: "a Worker bound to another bucket than the product's", current: false }],
  ["a Worker with no place it answers at is of an install that was never finished, whatever its database holds", { unfinished: true, drift: "SELECT 1" }, { drift: "a Worker of an install that was never finished", current: false }],
];

/** The fake account's database as this code makes it, with the drift run on it. */
async function databaseOf(drift: string | null | undefined): Promise<BunSqliteDriver> {
  const driver = new BunSqliteDriver();
  if (drift === null || drift === undefined) return driver;

  const opened = await openDatabase(driver, NOW);
  if (opened.kind !== "open") throw new Error(`the fake's database did not open: ${opened.kind}`);

  await opened.database.initSettings(defaultSettings({ installer: INSTALLER }), { as: "first_login", by: INSTALLER, at: NOW });
  await driver.batch([{ sql: drift, params: [] }]);

  return driver;
}

/** Answer as the account's API: the Worker's bindings, the list of its databases, and a query run on the database. `refuse` names the one call that is refused, or says that every query comes back as not run. */
async function answer(held: Held, driver: BunSqliteDriver, asked: Asked, refuse?: string): Promise<Response> {
  const [path = ""] = asked.path.split("?");
  const call = `${asked.method} ${path}`;
  if (call === refuse) return refusal(403, 10000, "Authentication error");

  if (call === SETTINGS && held.bucket === null) return refusal(404, 10007, "This Worker does not exist on your account.");

  if (call === SETTINGS) return reply({ bindings: [{ name: "SITES", type: "r2_bucket", bucket_name: held.bucket ?? "poplin-sites" }, ...(held.unfinished === true ? [] : FINISHED)] });

  if (call === DATABASES) return page(asked, held.drift === undefined ? [] : [{ uuid: DATABASE, name: "poplin" }]);

  if (refuse === NO_QUERY_RUNS) return reply([{ success: false }]);

  const { sql, params } = asked.body as { readonly sql: string; readonly params: readonly string[] };
  // A statement the database cannot run, such as a read of a table that is not there, is answered as an error of the API, never as a dropped connection.
  const ran = await driver.batch([{ sql, params }]).catch((error: unknown) => (error instanceof Error ? error : new Error(String(error))));
  if (ran instanceof Error) return refusal(400, 7500, `${ran.message}: SQLITE_ERROR`);

  return reply([{ results: ran[0]?.rows ?? [], success: true, meta: {} }]);
}

/** Read what stands on a fake account, and answer it with every call that was no read. */
async function standing(held: Held, refuse?: string): Promise<{ readonly standing: unknown; readonly changes: readonly string[] }> {
  using _step = catchStep();
  const driver = await databaseOf(held.drift);
  let told = { standing: undefined as unknown, changes: [] as string[] };

  await withFake(
    (asked) => answer(held, driver, asked, refuse),
    async (connection, asked) => {
      const read = await readStanding({ ...openRun({ CLOUDFLARE_API_TOKEN: "a-made-up-token", CLOUDFLARE_ACCOUNT_ID: ACCOUNT }), connection });
      told = { standing: read, changes: asked.filter((one) => one.method !== "GET" && !one.path.endsWith("/query")).map((one) => `${one.method} ${one.path.split("?")[0]}`) };
    },
  );

  return told;
}

describe("the look at what stands of the test install, against a local fake account", () => {
  // Drift: a look that changed the account would delete a database before anything checked that the account is a test account.
  test.each(CASES)("%s, and the look changes nothing", async (_what, held, read) => {
    expect(await standing(held)).toEqual({ standing: read, changes: [] });
  });

  test.each([
    ["the Worker's bindings", SETTINGS, { kind: "skipped", needs: "the token permission Workers Scripts: Edit" }],
    ["the list of its databases", DATABASES, { kind: "skipped", needs: "the token permission D1: Edit" }],
    ["a query of its database", `POST /accounts/${ACCOUNT}/d1/database/${DATABASE}/query`, { kind: "skipped", needs: "the token permission D1: Edit" }],
  ])("a token refused %s stops the run with the permission it needs", async (_what, refuse, stop) => {
    expect((await standing({ drift: OF_ANOTHER_BUILD }, refuse)).standing).toEqual(stop);
  });

  // Drift: a query that did not run has no rows, as a database no step ran on has none, so a database that was never read counted as one the Worker opens.
  test("a database whose queries do not run stops the run, and is called neither this commit's nor another build's", async () => {
    expect((await standing({ drift: OF_ANOTHER_BUILD }, NO_QUERY_RUNS)).standing).toEqual({ kind: "failed", what: "Cloudflare did not answer" });
  });

  // Drift: a token's row is stored once the database "is ready", and the wait for a new deployment reads the same answer; a database the new Worker has not started on has no table for the row.
  test.each([
    ["a database no step ran on", null, undefined, false],
    ["a database this code made", "SELECT 1", undefined, true],
    ["a database a step behind this commit", BEHIND, undefined, false],
    ["a database whose step another build applied", OF_ANOTHER_BUILD, undefined, false],
    ["a database whose queries do not run", "SELECT 1", NO_QUERY_RUNS, { kind: "failed", what: "Cloudflare did not answer" }],
  ])("%s holds this commit's schema, or does not, or was not read", async (_what, drift, refuse, holds) => {
    using _step = catchStep();
    const driver = await databaseOf(drift);
    let told: unknown;

    await withFake(
      (asked) => answer({ drift }, driver, asked, refuse),
      async (connection) => {
        told = await holdsOwnSchema({ ...openRun({ CLOUDFLARE_API_TOKEN: "a-made-up-token", CLOUDFLARE_ACCOUNT_ID: ACCOUNT }), connection }, DATABASE);
      },
    );

    expect(told).toEqual(holds);
  });

  // Drift: the one sign a run has that the install's sweep trigger fires is the moment the sweep last asked for a newer version; a read of another row would call a silent trigger a working one.
  test("the moment the install last asked for a newer version is read from its database: none before the first sweep, then the moment the sweep kept", async () => {
    using _step = catchStep();
    const driver = await databaseOf("SELECT 1");
    const read: unknown[] = [];

    await withFake(
      (asked) => answer({ drift: "SELECT 1" }, driver, asked),
      async (connection) => {
        const run = { ...openRun({ CLOUDFLARE_API_TOKEN: "a-made-up-token", CLOUDFLARE_ACCOUNT_ID: ACCOUNT }), connection };
        read.push(await lastAsked(run, DATABASE));
        await new SqlDatabase(driver).keepUpdateCheck({ checked_at: NOW + 60_000, news: null });
        read.push(await lastAsked(run, DATABASE));
      },
    );

    expect(read).toEqual([undefined, NOW + 60_000]);
  });
});
