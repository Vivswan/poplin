// The check of the test install's database runs against a local fake of the Cloudflare API whose database is a real SQLite.
// A schema step changed in place keeps its number: the Worker of the next commit met the database of the last one, and every address of the test install answered 503.

import { describe, expect, test } from "bun:test";

import { settleDatabase } from "../../packages/cloudflare/scripts/live/shape";
import { openRun } from "../../packages/cloudflare/scripts/live/util";
import { withFake } from "../../packages/cloudflare/tests/zone/support/fake-cloudflare";
import { type Asked, refusal, reply } from "../../packages/cloudflare/tests/zone/support/replies";
import type { Login } from "../../packages/core/src/auth/logins";
import { openDatabase } from "../../packages/core/src/database/open";
import { defaultSettings } from "../../packages/core/src/records/settings";
import { BunSqliteDriver } from "../../packages/core/tests/database/support/bun-sqlite-driver";
import { catchStep } from "./support/step";

/** The account the fake holds. */
const ACCOUNT = "0".repeat(32);

/** The database the account holds before a run, and the one Cloudflare makes when asked for another. */
const [OLD, NEW] = ["database-1", "database-2"];

/** The moment the fake's database was made. */
const NOW = 1_700_000_000_000;

/** The admin whose settings the fake's install starts with. */
const INSTALLER = "ada@example.com" as Login;

/** The calls that delete the database and make it anew. */
const REMAKE = [`DELETE /accounts/${ACCOUNT}/d1/database/${OLD}`, `POST /accounts/${ACCOUNT}/d1/database`];

/** In place of a refused call: Cloudflare answers every query as not run. */
const NO_QUERY_RUNS = "no query runs";

/** One database, what a run answers of it, and the calls that changed the account. `drift` is SQL run on a database this code made, settings and all; `null` leaves the database empty. */
type Case = readonly [what: string, drift: string | null, settled: unknown, changes: readonly string[]];

const CASES: readonly Case[] = [
  ["a database no step ran on is left for the Worker to fill", null, { id: OLD, result: "present" }, []],
  ["a database this code made, with its settings, is left", "SELECT 1", { id: OLD, result: "present" }, []],
  [
    "a database whose settings lack a setting this code reads is made anew",
    "UPDATE settings SET value = json_remove(value, '$.max_storage_writes_per_day')",
    { id: NEW, result: "made anew: it held settings this commit does not read" },
    REMAKE,
  ],
  [
    "a database whose schema step another build applied is made anew",
    "UPDATE schema_steps SET fingerprint = 'of another build'",
    { id: NEW, result: "made anew: it held schema step 1 as another build applied it" },
    REMAKE,
  ],
  [
    "a database with a step this code does not have is made anew",
    "INSERT INTO schema_steps (step, description, applied_at, fingerprint) VALUES (999, 'a step of a later commit', 0, 'later')",
    { id: NEW, result: "made anew: it held a schema step this commit does not have" },
    REMAKE,
  ],
];

/** The fake account's database as this code makes it, with the drift run on it. */
async function databaseOf(drift: string | null): Promise<BunSqliteDriver> {
  const driver = new BunSqliteDriver();
  if (drift === null) return driver;

  const opened = await openDatabase(driver, NOW);
  if (opened.kind !== "open") throw new Error(`the fake's database did not open: ${opened.kind}`);

  await opened.database.initSettings(defaultSettings({ installer: INSTALLER, hostname: "poplin.example.com" }), { by: INSTALLER, at: NOW });
  await driver.batch([{ sql: drift, params: [] }]);

  return driver;
}

/** Answer as the account's D1 API: a query runs on the database, a delete and a create are taken, and `refuse` names the one call that is refused, or says that every query comes back as not run. */
async function answer(driver: BunSqliteDriver, asked: Asked, refuse?: string): Promise<Response> {
  const [path = ""] = asked.path.split("?");
  if (`${asked.method} ${path}` === refuse) return refusal(403, 10000, "Authentication error");

  if (refuse === NO_QUERY_RUNS) return reply([{ success: false }]);

  if (asked.method === "DELETE") return reply(null);

  if (!path.endsWith("/query")) return reply({ uuid: NEW, name: "poplin" });

  const { sql, params } = asked.body as { readonly sql: string; readonly params: readonly string[] };
  const [result] = await driver.batch([{ sql, params }]);

  return reply([{ results: result?.rows ?? [], success: true, meta: {} }]);
}

/** Run the check on a fake account, and answer what it settled with the calls that changed the account. */
async function settle(drift: string | null, refuse?: string): Promise<{ readonly settled: unknown; readonly changes: readonly string[] }> {
  using _step = catchStep();
  const driver = await databaseOf(drift);
  let told = { settled: undefined as unknown, changes: [] as string[] };

  await withFake(
    (asked) => answer(driver, asked, refuse),
    async (connection, asked) => {
      const settled = await settleDatabase({ ...openRun({ CLOUDFLARE_API_TOKEN: "a-made-up-token", CLOUDFLARE_ACCOUNT_ID: ACCOUNT }), connection }, OLD);
      told = { settled, changes: asked.filter((one) => !one.path.endsWith("/query")).map((one) => `${one.method} ${one.path.split("?")[0]}`) };
    },
  );

  return told;
}

describe("the check of the test install's database, against a local fake account", () => {
  test.each(CASES)("%s", async (_what, drift, settled, changes) => {
    expect(await settle(drift)).toEqual({ settled, changes });
  });

  // Drift: a run that stopped half-way and called it done would deploy a Worker bound to a database that is gone.
  test.each([
    ["the delete", REMAKE.slice(0, 1)],
    ["the making of the new one", REMAKE],
  ])("a token refused %s stops the run with the permission it needs", async (_what, changes) => {
    const told = await settle("UPDATE schema_steps SET fingerprint = 'of another build'", changes.at(-1));

    expect(told).toEqual({ settled: { kind: "skipped", needs: "the token permission D1: Edit" }, changes });
  });

  // Drift: a query that did not run has no rows, as a database no step ran on has none, so a database that was never read counted as one the Worker opens.
  test("a database whose queries do not run stops the run, and is neither left nor made anew", async () => {
    const told = await settle("UPDATE schema_steps SET fingerprint = 'of another build'", NO_QUERY_RUNS);

    expect(told).toEqual({ settled: { kind: "failed", what: "the database did not run a statement" }, changes: [] });
  });
});
