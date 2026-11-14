// An install the API tests send requests to: a real database on bun's SQLite, a store in memory, three tokens, and a client built from core's route table alone.

import { ROUTES, type Route } from "@poplin/core/src/api/routes";
import type { Login } from "@poplin/core/src/auth/logins";
import { mintToken } from "@poplin/core/src/auth/tokens";
import type { Database } from "@poplin/core/src/database/database";
import type { SqlDriver, Statement, StatementResult } from "@poplin/core/src/database/driver";
import { openDatabase } from "@poplin/core/src/database/open";
import { defaultSettings } from "@poplin/core/src/records/settings";
import { MemoryStore } from "@poplin/core/src/storage/memory";
import type { ObjectStore } from "@poplin/core/src/storage/storage";
import { BunSqliteDriver } from "@poplin/core/tests/database/support/bun-sqlite-driver";

import { type ApiLimits, createApi } from "../../../src/api/api";
import { HOSTNAME_RESERVED_NAMES } from "../../../src/sites/hostname-addresses";

/** The moment every test request arrives at, unless the test moves the clock. */
export const NOW = 1_700_000_000_000;

/** Where the test install answers. */
export const ORIGIN = "https://admin.example.com";

/** What one request to the test install can carry: small, so a test passes each cap with a few bytes. */
export const LIMITS: ApiLimits = { fileBytes: 64, files: 8, manifestBytes: 4096 };

/** The admin whose settings the install starts with. */
const INSTALLER = "ada@example.com" as Login;

/** The name of a route in core's table. */
type RouteName = keyof typeof ROUTES;

/** What a route's path is built from. */
type ArgsOf<Name extends RouteName> = Parameters<(typeof ROUTES)[Name]["path"]>[0];

/** What goes with one call besides the route's arguments. A `token` of `null` sends no `Authorization` header. */
interface Sent {
  readonly token?: string | null;
  readonly body?: unknown;
  readonly headers?: Readonly<Record<string, string>>;
}

/** What a call answered: the status, the parsed JSON body, which is empty for an answer that is no JSON, and the response itself. */
export interface Answered {
  readonly status: number;
  readonly body: Record<string, unknown>;
  readonly response: Response;
}

/**
 * A test install. `tokens` are whole tokens: an admin's, and two publishers'. `reported` holds every failure the API was told of.
 *
 * `calls` counts every batch sent to the database and every call made to the store, since the test last set it to zero.
 */
export interface ApiInstall {
  readonly api: ReturnType<typeof createApi>;
  readonly database: Database;
  readonly store: MemoryStore;
  readonly calls: { database: number; store: number };
  readonly clock: { now: number };
  readonly tokens: { readonly admin: string; readonly owner: string; readonly stranger: string };
  readonly reported: unknown[];
  readonly keys: () => Promise<string[]>;
  readonly audit: () => Promise<number>;
  readonly ask: (request: Request) => Promise<Answered>;
  readonly call: <Name extends RouteName>(name: Name, args: ArgsOf<Name>, sent?: Sent) => Promise<Answered>;
}

/** A driver that counts the batches it passes on. */
class CountingDriver implements SqlDriver {
  readonly #inner = new BunSqliteDriver();

  readonly #calls: { database: number };

  constructor(calls: { database: number }) {
    this.#calls = calls;
  }

  batch(statements: readonly Statement[]): Promise<readonly StatementResult[]> {
    this.#calls.database += 1;

    return this.#inner.batch(statements);
  }
}

/** The store with every call to it counted. Each call finds the store's method anew, so a test that swaps one in is heard. */
function counted(store: MemoryStore, calls: { store: number }): ObjectStore {
  const count = (): MemoryStore => {
    calls.store += 1;

    return store;
  };

  return {
    head: (key) => count().head(key),
    read: (key, options) => count().read(key, options),
    write: (key, body, options) => count().write(key, body, options),
    delete: (key) => count().delete(key),
    deleteMany: (keys) => count().deleteMany(keys),
    list: (options) => count().list(options),
  };
}

/** The body and the content type a route's request goes with. */
function bodyOf(route: Route<never, unknown, unknown>, body: unknown): { readonly body?: BodyInit; readonly type?: string } {
  if (route.sends === "nothing") return {};

  if (route.sends === "json") return { body: JSON.stringify(body), type: "application/json" };

  return { body: typeof body === "string" ? new TextEncoder().encode(body) : (body as BodyInit), type: "application/octet-stream" };
}

/**
 * Build the request of one route, as a client that knows core's table and nothing else would.
 *
 * @param sent - the token, the body, and headers that replace the built ones
 */
export function requestOf<Name extends RouteName>(name: Name, args: ArgsOf<Name>, sent: Sent = {}): Request {
  const route = ROUTES[name] as Route<ArgsOf<Name>, unknown, unknown>;
  const { body, type } = bodyOf(route, sent.body);
  const headers = new Headers(sent.headers);
  if (type !== undefined && !headers.has("Content-Type")) headers.set("Content-Type", type);
  if (sent.token != null) headers.set("Authorization", `Bearer ${sent.token}`);

  // A stream body is sent as it is read, which a request must say.
  return new Request(`${ORIGIN}${route.path(args)}`, { method: route.method, headers, body, duplex: "half" } as RequestInit);
}

/** Open a fresh install with default settings, laid over by `overrides`, and its three tokens. */
export async function openApi(overrides: Partial<ReturnType<typeof defaultSettings>> = {}): Promise<ApiInstall> {
  const calls = { database: 0, store: 0 };
  const driver = new CountingDriver(calls);
  const opened = await openDatabase(driver, NOW);
  if (opened.kind !== "open") throw new Error(`the test's database did not open: ${opened.kind}`);

  const { database } = opened;
  const signed = { by: INSTALLER, at: NOW };
  await database.initSettings({ ...defaultSettings({ installer: INSTALLER, hostname: "admin.example.com" }), ...overrides }, signed);

  const minted = await Promise.all((["admin", "publisher", "publisher"] as const).map((scope) => mintToken({ scope, note: "a test", now: NOW })));
  for (const { record } of minted) await database.addToken(record, signed);

  const [admin, owner, stranger] = minted.map(({ token }) => token);
  if (admin === undefined || owner === undefined || stranger === undefined) throw new Error("the test's tokens were not minted");

  const store = new MemoryStore();
  const clock = { now: NOW };
  const reported: unknown[] = [];
  const api = createApi({
    database,
    store: counted(store, calls),
    now: () => clock.now,
    addressOf: (label) => `https://${label}-page.example.com`,
    reservedNames: HOSTNAME_RESERVED_NAMES,
    readToken: (id) => database.getToken(id),
    limits: LIMITS,
    report: (error) => reported.push(error),
  });

  const ask = async (request: Request): Promise<Answered> => {
    const response = await api.fetch(request);
    const text = await response.clone().text();

    // A route that answers a file's bytes has no JSON to parse: its body is read from `response`.
    const isJson = response.headers.get("Content-Type")?.startsWith("application/json") === true;

    return { status: response.status, body: text === "" || !isJson ? {} : JSON.parse(text), response };
  };

  return {
    api,
    database,
    store,
    calls,
    clock,
    tokens: { admin, owner, stranger },
    reported,
    keys: async () => (await store.list({ prefix: "" })).objects.map((object) => object.key),
    audit: async () => (await driver.batch([{ sql: "SELECT COUNT(*) AS entries FROM audit", params: [] }]))[0]?.rows[0]?.entries as number,
    ask,
    call: (name, args, sent = {}) => ask(requestOf(name, args, { token: admin, ...sent })),
  };
}
