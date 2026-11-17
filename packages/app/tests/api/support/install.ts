// An install the API tests send requests to: a real database on bun's SQLite, a store in memory, three tokens, and a client typed from the routes the API declares.

import type { Login } from "@poplin/core/src/auth/logins";
import type { Install } from "@poplin/core/src/actions/records";
import { mintToken } from "@poplin/core/src/auth/tokens";
import type { Database } from "@poplin/core/src/database/database";
import type { SqlDriver, Statement, StatementResult } from "@poplin/core/src/database/driver";
import { openDatabase } from "@poplin/core/src/database/open";
import type { Jobs } from "@poplin/core/src/jobs/jobs";
import { DEFAULT_PUBLIC_WORD } from "@poplin/core/src/names/marker";
import { defaultSettings, type RuleSettings } from "@poplin/core/src/records/settings";
import { ADDRESS_LAYOUT } from "@poplin/core/src/sites/address-layout";
import { MemoryStore } from "@poplin/core/src/storage/memory";
import type { Tickets } from "@poplin/core/src/storage/tickets";
import type { ObjectStore } from "@poplin/core/src/storage/storage";
import { BunSqliteDriver } from "@poplin/core/tests/database/support/bun-sqlite-driver";
import { type ClientRequestOptions, hc } from "hono/client";
import * as v from "valibot";

import { type Api, type ApiLimits, createApi } from "../../../src/api/api";
import { MemoryCounters } from "../../../src/limits/memory-counters";
import { addressesUnder } from "../../sites/support/layout";
import { hostUpdate, type UpdateHost, updateHost } from "./update-host";

/** The moment every test request arrives at, unless the test moves the clock. */
export const NOW = 1_700_000_000_000;

/** Where the test install answers. */
export const ORIGIN = "https://poplin.example.com";

/** What one request to the test install can carry: small, so a test passes each cap with a few bytes. A site of 130 files is one that two requests copy. */
export const LIMITS: ApiLimits = { fileBytes: 64, files: 130, manifestBytes: 16_384 };

/** The version the test install says it runs: one no build of poplin states, so a test that reads it cannot pass on the workspace's own. */
export const INSTALL_VERSION = "7.8.9";

/** The request header a test names its visitor in; every request without it comes from one visitor. */
export const VISITOR_HEADER = "Test-Visitor";

/** The admin whose settings the install starts with. */
const INSTALLER = "ada@example.com" as Login;

/** The layout an install answers unless a test gives another. */
const DEFAULT_LAYOUT: LayoutInput = { kind: "hostname", public_word: DEFAULT_PUBLIC_WORD };

/** A layout as a test writes it, before it is checked. */
export type LayoutInput = v.InferInput<typeof ADDRESS_LAYOUT>;

/** The routes of the API as a client typed from them calls them: `routes.sites[":site"].$get({ param, query })`. */
export type ApiClient = ReturnType<typeof hc<Api>>["api"];

/** What a call answered: the status, the parsed JSON body, which is empty for an answer that is no JSON, and the response itself. */
export interface Answered {
  readonly status: number;
  readonly body: Record<string, unknown>;
  readonly response: Response;
}

/**
 * A test install. `tokens` are whole tokens: an admin's, and two publishers'. `reported` holds every failure the API was told of.
 * `routes` sends as the admin, `as` as another token or, for `null`, with no `Authorization` header, and `ask` sends a request written out by hand. `requests` holds every request the three sent, in order.
 *
 * `calls` counts every batch sent to the database and every call made to the store, since the test last set it to zero.
 * `counters` count the requests to the routes that take no token; a test breaks them by replacing `takeMinute`. `rules` and `logs` stand in for the provider's side of the domain's rules and of the logs, with a key: `pushed` holds every try.
 * `users` stands in for the provider's side of the users: `pushed` holds every list of users handed over, `ended` counts the tries to end every login, and `takes` says whether the provider takes either; it starts with no key, and takes none.
 * `host` stands in for the install's host: `key` is whether it holds the key an update is sent with, `release` the newest release above the running version or `null`, `refusal` what it refuses that release with, and `put` every version it put in place.
 * `direct` stands in for the host's tickets past the install: with `tickets` set, the host hands those out; it starts as a host that has none.
 */
export interface ApiInstall {
  readonly api: ReturnType<typeof createApi>;
  readonly install: Install;
  readonly database: Database;
  readonly store: MemoryStore;
  readonly calls: { database: number; store: number };
  readonly counters: MemoryCounters;
  readonly host: UpdateHost;
  readonly clock: { now: number };
  readonly users: { takes: boolean; readonly pushed: (readonly string[])[]; ended: number };
  readonly rules: { readonly pushed: RuleSettings[] };
  readonly logs: { readonly pushed: boolean[] };
  readonly direct: { tickets: Tickets | undefined };
  readonly tokens: { readonly admin: string; readonly owner: string; readonly stranger: string };
  readonly reported: unknown[];
  readonly keys: () => Promise<string[]>;
  readonly audit: () => Promise<number>;
  readonly routes: ApiClient;
  readonly as: (token: string | null, headers?: Readonly<Record<string, string>>) => ApiClient;
  readonly ask: (request: Request) => Promise<Answered>;
  readonly requests: Request[];
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

/**
 * Build what a typed call is given second to send a body as it is: the bytes of a file, or text the type of its route does not take.
 *
 * @param headers - headers that go with the body; a `Content-Type` here replaces the one of a file's bytes
 */
export function bytes(body: string | Uint8Array | ReadableStream<Uint8Array>, headers: Readonly<Record<string, string>> = {}): ClientRequestOptions {
  const sent = typeof body === "string" ? new TextEncoder().encode(body) : body;

  // A stream body is sent as it is read, which a request must say.
  return { headers: { "Content-Type": "application/octet-stream", ...headers }, init: { body: sent, duplex: "half" } as RequestInit };
}

/**
 * Read what a call answered.
 *
 * @param sent - the call of a typed route, or any other response on its way
 */
export async function answered(sent: Promise<Pick<Response, "status" | "headers">>): Promise<Answered> {
  // A typed call narrows the type of the response it was handed; the value is that response.
  const response = (await sent) as Response;
  const text = await response.clone().text();

  // A route that answers a file's bytes has no JSON to parse: its body is read from `response`.
  const isJson = response.headers.get("Content-Type")?.startsWith("application/json") === true;

  return { status: response.status, body: text === "" || !isJson ? {} : JSON.parse(text), response };
}

/**
 * Open a fresh install with default settings, laid over by `overrides`, and its three tokens.
 *
 * @param limits - what one request can carry, in place of the small caps of `LIMITS`
 * @param layout - how the install says its site addresses are laid out, in place of hostnames that end in `page`; the addresses it answers stay hostnames
 * @param jobs - the host's background work; left out, a host that has none
 */
export async function openApi(overrides: Partial<ReturnType<typeof defaultSettings>> = {}, limits: ApiLimits = LIMITS, layout: LayoutInput = DEFAULT_LAYOUT, jobs?: Jobs): Promise<ApiInstall> {
  const calls = { database: 0, store: 0 };
  const driver = new CountingDriver(calls);
  const opened = await openDatabase(driver, NOW);
  if (opened.kind !== "open") throw new Error(`the test's database did not open: ${opened.kind}`);

  const { database } = opened;
  await database.initSettings({ ...defaultSettings({ installer: INSTALLER }), ...overrides }, { as: "first_login", by: INSTALLER, at: NOW });

  const minted = await Promise.all((["admin", "publisher", "publisher"] as const).map((scope) => mintToken({ scope, note: "a test", now: NOW })));
  for (const { record } of minted) await database.addToken(record, { as: "person", by: INSTALLER, at: NOW });

  const [admin, owner, stranger] = minted.map(({ token }) => token);
  if (admin === undefined || owner === undefined || stranger === undefined) throw new Error("the test's tokens were not minted");

  const store = new MemoryStore();
  const clock = { now: NOW };
  const reported: unknown[] = [];
  const counters = new MemoryCounters();
  const host = updateHost("7.9.0");
  const users: ApiInstall["users"] = { takes: false, pushed: [], ended: 0 };
  const rules: ApiInstall["rules"] = { pushed: [] };
  const logs: ApiInstall["logs"] = { pushed: [] };
  const direct: ApiInstall["direct"] = { tickets: undefined };
  const said = v.parse(ADDRESS_LAYOUT, layout);
  const addresses = addressesUnder(said.kind === "hostname" ? said.public_word : DEFAULT_PUBLIC_WORD);
  const install: Install = {
    database,
    store: counted(store, calls),
    now: () => clock.now,
    addressOf: addresses.addressOf,
    publicAddressOf: addresses.publicAddressOf,
    reservedNames: addresses.reservedNames,
  };
  const api = createApi({
    ...install,
    ...(jobs === undefined ? {} : { jobs }),
    readToken: (id) => database.getToken(id),
    limits,
    version: INSTALL_VERSION,
    layout: said,
    report: (error) => reported.push(error),
    // Found anew on every request, so a test that swaps the method in is heard.
    counters: { takeMinute: (window, now) => counters.takeMinute(window, now) },
    visitorOf: async (request) => request.headers.get(VISITOR_HEADER) ?? "one-visitor",
    follow: {
      where: "Example Cloud",
      holdsKey: () => users.takes,
      push: async (emails) => {
        users.pushed.push(emails);

        return users.takes ? { ok: true } : { ok: false, refusal: "no_key" };
      },
    },
    endLogins: async () => {
      users.ended += 1;

      return users.takes ? { ok: true } : { ok: false, refusal: "no_key" };
    },
    rules: {
      holdsKey: () => true,
      push: async (values) => {
        rules.pushed.push(values);

        return { ok: true };
      },
    },
    logs: {
      holdsKey: () => true,
      push: async (kept) => {
        logs.pushed.push(kept);

        return { ok: true };
      },
    },
    update: hostUpdate(host),
    direct: () => direct.tickets,
  });

  const requests: Request[] = [];
  const send = (request: Request): Promise<Response> => {
    requests.push(request);

    return api.fetch(request);
  };
  const as: ApiInstall["as"] = (token, headers = {}) => {
    const fetch = (input: string | URL | Request, init?: RequestInit): Promise<Response> => send(new Request(input, init));

    return hc<Api>(ORIGIN, { fetch: fetch as typeof globalThis.fetch, headers: token === null ? headers : { ...headers, Authorization: `Bearer ${token}` } }).api;
  };

  return {
    api,
    install,
    database,
    store,
    calls,
    counters,
    clock,
    users,
    rules,
    logs,
    host,
    direct,
    tokens: { admin, owner, stranger },
    reported,
    keys: async () => (await store.list({ prefix: "" })).objects.map((object) => object.key),
    audit: async () => (await driver.batch([{ sql: "SELECT COUNT(*) AS entries FROM audit", params: [] }]))[0]?.rows[0]?.entries as number,
    routes: as(admin),
    as,
    ask: (request) => answered(send(request)),
    requests,
  };
}
