// The world a run of the live harness meets in a test: the fake Cloudflare account in memory, a build of the Worker as this commit's, and an install that answers once its Worker stands.
// No port is opened, and nothing waits: the clock moves in a rest alone.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { Login } from "../../../../../core/src/auth/logins";
import type { SqlValue } from "../../../../../core/src/database/driver";
import type { SettingValues } from "../../../../../core/src/records/settings";
import { MemoryStore } from "../../../../../core/src/storage/memory";
import { publish, reachOf } from "../../../scripts/live/commands";
import type { World } from "../../../scripts/live/converge";
import { type Found, openRun, type Run, TEST_MARK } from "../../../scripts/live/util";
import { MAP_FILE, MODULE_FILE } from "../../../src/shared/release/deploy/bundle-manifest";
import { ACCOUNT, type Account, emptyAccount, TOKEN } from "../../shared/install/support/fake-install";
import { worldOf } from "../../shared/install/support/fake-reach";
import { storeOf } from "../../shared/install/support/fake-store";
import { type Asked, reply } from "../../shared/install/support/replies";
import { apiOver } from "./sql-install";

/** The version of the build a test publishes as this commit's: another than the one the fake website names. */
export const COMMIT = "0.4.0";

/** The first login of an install a run makes. */
export const LOGIN = "owner@example.com" as Login;

/** The repository's own Worker configuration, which the build's manifest is written from. */
const CONFIG: unknown = Bun.JSONC.parse(readFileSync(join(import.meta.dir, "..", "..", "..", "..", "..", "..", "wrangler.jsonc"), "utf8"));

/** The text of the module a test publishes as this commit's: another than the one the fake website's release holds. */
export const COMMIT_MODULE = "export default { commit: true };\n";

/** The built module and its map, as any bytes. */
const FILES = { [MODULE_FILE]: new TextEncoder().encode(COMMIT_MODULE), [MAP_FILE]: new TextEncoder().encode('{"version":3,"sources":[],"mappings":""}') };

/** A placeholder with no number, which Cloudflare's API numbers in order and the fake database does not take. */
const BARE = /\?(?!\d)/g;

/** The path the fake account is asked for its subscriptions at, which it holds none of. */
const SUBSCRIPTIONS = "/subscriptions";

/** The removal of a database, with which what it held goes. */
const DATABASE_REMOVAL = /\/d1\/database\/[^/?]+$/;

/** The databases a Worker of a test has started on, each with the install that answers from it. */
const STARTED = new WeakMap<object, Standing>();

/** An install whose Worker started: what sends a request to its real API, and its settings as its database holds them. */
interface Standing {
  readonly fetch: World["fetch"];
  readonly settings: () => Promise<SettingValues | undefined>;
}

/** The world of one test. */
interface Harness {
  /** The account, which every call reads and changes. */
  readonly account: Account;

  /** The run, whose lines are kept in `lines` with every hidden name taken out. */
  readonly run: Run;

  /** What a run is made with. */
  readonly world: World;

  /** Every line the run said. */
  readonly lines: string[];

  /** Every call sent to Cloudflare. */
  readonly asked: Asked[];

  /** Every request sent to the install, as its method and path. */
  readonly sent: string[];

  /** The outputs of the step, by name. */
  readonly outputs: Record<string, string>;

  /** The settings the install's database holds; `undefined` where no Worker has started on it. */
  readonly settings: () => Promise<SettingValues | undefined>;
}

/** A test account with nothing of an install in it, and no Worker. */
export function freshAccount(changes: Partial<Account> = {}): Account {
  return { ...emptyAccount(), bindings: [], noWorker: true, buckets: [{ name: TEST_MARK }], ...changes };
}

/**
 * Start a Worker on an account that holds no database a Worker started on: the database is left at this commit's schema, with the first login, and the real API answers from it.
 *
 * The database is asked the way Cloudflare's API is asked: a placeholder with no number is numbered in order.
 */
async function start(account: Account, kind: Found["kind"]): Promise<Standing> {
  const store = await storeOf(LOGIN);
  const call = (sql: string, params: readonly SqlValue[]): ReturnType<typeof store.call> => {
    let next = 0;

    return store.call(
      sql.replace(BARE, () => `?${++next}`),
      params,
    );
  };
  const standing = { fetch: apiOver(store.database, new MemoryStore(), kind).fetch, settings: () => store.database.readSettings() };
  account.store = { call };
  STARTED.set(account.store, standing);

  return standing;
}

/** Whether a request reaches the Worker: by a route of its domain, or by its two forwarders and its own free address. */
function reaches(account: Account, kind: Found["kind"]): boolean {
  return kind === "domain" ? account.routes.length > 0 : account.workers.length === 2 && account.address.enabled === true;
}

/** The install that answers on an account: none without a Worker or a way to it, and none on a database a test made by hand, which no Worker here started on. A Worker's first answer on an account with no database of its own is its start. */
async function standingOn(account: Account, kind: Found["kind"]): Promise<Standing | undefined> {
  if (account.noWorker === true || !reaches(account, kind)) return undefined;

  return account.store === undefined ? start(account, kind) : STARTED.get(account.store);
}

/**
 * Build the world of one test around an account.
 *
 * @param account - the account at the fake API
 * @returns the run and what it is made with; a rest moves the clock and waits for nothing
 */
export async function harnessOf(account: Account, kind: Found["kind"]): Promise<Harness> {
  const [lines, sent]: [string[], string[]] = [[], []];
  const outputs: Record<string, string> = {};
  let clock = 0;
  const install: World["fetch"] = async (input, init) => {
    sent.push(`${init.method ?? "GET"} ${new URL(input).pathname}`);
    const standing = await standingOn(account, kind);

    return standing === undefined ? new Response("no Worker answers here", { status: 503 }) : standing.fetch(input, init);
  };
  const settings = async (): Promise<SettingValues | undefined> => (account.store === undefined ? undefined : STARTED.get(account.store)?.settings());
  const inner = await worldOf(account);
  const pass: typeof inner.reach.fetch = async (input, init) => {
    const address = input instanceof Request ? input.url : String(input);
    if (address.endsWith(SUBSCRIPTIONS)) return reply([]);

    if (new URL(address).pathname === "/api/whoami") return install(address, init ?? {});

    const answered = await inner.reach.fetch(input, init);
    // A database that is removed takes what it held with it.
    if (init?.method === "DELETE" && DATABASE_REMOVAL.test(address) && answered.ok) account.store = undefined;

    return answered;
  };
  const release = await publish({ version: COMMIT, config: CONFIG, files: FILES });
  const reach = { ...reachOf(release, pass), now: () => clock };
  const opened = openRun({ CLOUDFLARE_API_TOKEN: TOKEN, CLOUDFLARE_ACCOUNT_ID: ACCOUNT });
  const run: Run = {
    ...opened,
    connection: { key: TOKEN, fetch: pass },
    say: (line) => void lines.push(opened.redact(line)),
    annotate: (level, text) => void lines.push(`::${level}::${opened.redact(text)}`),
    summarize: () => undefined,
    output: (name, value) => void Object.assign(outputs, { [name]: opened.redact(value) }),
  };
  const sleep = async (milliseconds: number): Promise<void> => {
    clock += milliseconds;
  };

  return { account, run, lines, sent, outputs, settings, asked: inner.asked, world: { release, ends: { reach, sleep }, fetch: install } };
}
