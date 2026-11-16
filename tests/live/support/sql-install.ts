// A local install whose database a test also reaches with SQL: the real API on bun's SQLite and a store in memory, for the self-test of what the live harness does to a database directly.

import { createApi } from "../../../packages/app/src/api/api";
import { MemoryCounters } from "../../../packages/app/src/limits/memory-counters";
import { pathAddresses } from "../../../packages/app/src/sites/path-addresses";
import { ADDRESSES } from "../../../packages/app/tests/sites/support/layout";
import type { Fetch } from "../../../packages/cli/src/client/client";
import type { Login } from "../../../packages/core/src/auth/logins";
import { mintToken } from "../../../packages/core/src/auth/tokens";
import { openDatabase } from "../../../packages/core/src/database/open";
import { type Hostname, parseHostname } from "../../../packages/core/src/names/hostname";
import { DEFAULT_PUBLIC_WORD } from "../../../packages/core/src/names/marker";
import { defaultSettings, type SettingValues } from "../../../packages/core/src/records/settings";
import { MemoryStore } from "../../../packages/core/src/storage/memory";
import { BunSqliteDriver } from "../../../packages/core/tests/database/support/bun-sqlite-driver";

/** The moment every request arrives at. */
export const FAKE_NOW = 1_700_000_000_000;

/** How long a token the fake makes is good for, in milliseconds. */
const TOKEN_MS = 60 * 60 * 1000;

/** The hostname the fake's API answers on. */
const ADMIN_HOST = "poplin.example.com";

/** The three hostnames of a fake without a domain, on an account's free address. */
const FREE_HOSTS = { admin: "poplin.example.workers.dev", sites: "poplin-sites.example.workers.dev", private: "poplin-private.example.workers.dev" } as const;

/** The admin whose settings the install starts with. */
const INSTALLER = "ada@example.com" as Login;

/** The version the fake says it runs. */
const VERSION = "1.0.0";

/** What one request can carry: room for the repository's sample sites and the built demo, whose largest file is the dashboard's script of about 1 MB. */
const LIMITS = { fileBytes: 2_000_000, files: 100, manifestBytes: 100_000 };

/** A fake install: what sends a request to it, and its database as SQL reaches it. */
interface SqlInstall {
  /** The origin the API answers on. */
  readonly server: string;

  /** Sends one request to the API. */
  readonly fetch: Fetch;

  /** Runs one statement and answers its rows. */
  readonly sql: (statement: string, params?: readonly (string | number | null)[]) => Promise<readonly Record<string, unknown>[]>;

  /** Stores a new admin token's row, as the harness does, and answers the token. */
  readonly addToken: (note: string) => Promise<string>;

  /** The settings as the install holds them now. */
  readonly settings: () => Promise<SettingValues | undefined>;
}

/** Check a hostname the fake wrote by hand; a refusal is a mistake in the fake. */
function hostOf(raw: string): Hostname {
  const hostname = parseHostname(raw);
  if (!hostname.ok) throw new Error(`the fake's hostname was refused: ${hostname.refusal}`);

  return hostname.value;
}

/**
 * Open a fake install with no site and no token.
 *
 * @param kind - `account address` for an install without a domain, whose every site is a path on one of two hosts
 * @throws {Error} the database did not open
 */
export async function openSqlInstall(kind: "domain" | "account address" = "domain"): Promise<SqlInstall> {
  const driver = new BunSqliteDriver();
  const opened = await openDatabase(driver, FAKE_NOW);
  if (opened.kind !== "open") throw new Error(`the fake's database did not open: ${opened.kind}`);

  const { database } = opened;
  await database.initSettings(defaultSettings({ installer: INSTALLER }), { by: INSTALLER, at: FAKE_NOW });

  const counters = new MemoryCounters();
  const free = kind === "account address";
  const addresses = free ? pathAddresses({ sitesHost: hostOf(FREE_HOSTS.sites), privateHost: hostOf(FREE_HOSTS.private) }) : ADDRESSES;
  const api = createApi({
    database,
    store: new MemoryStore(),
    now: () => FAKE_NOW,
    addressOf: addresses.addressOf,
    publicAddressOf: addresses.publicAddressOf,
    reservedNames: addresses.reservedNames,
    readToken: (id) => database.getToken(id),
    limits: LIMITS,
    version: VERSION,
    layout: free ? { kind: "path", sites_host: FREE_HOSTS.sites, private_host: FREE_HOSTS.private } : { kind: "hostname", public_word: DEFAULT_PUBLIC_WORD },
    counters,
    visitorOf: async () => "one-visitor",
    update: { holdsKey: () => false, ready: async () => ({ ok: false, code: "no_key" }) },
  });

  const sql: SqlInstall["sql"] = async (statement, params = []) => (await driver.batch([{ sql: statement, params: [...params] }]))[0]?.rows ?? [];

  return {
    server: `https://${free ? FREE_HOSTS.admin : ADMIN_HOST}`,
    fetch: (input, init) => api.fetch(new Request(input, init)),
    sql,
    addToken: async (note) => {
      const { token, record } = await mintToken({ scope: "admin", note, now: FAKE_NOW });
      await sql("INSERT INTO tokens (id, hash, scope, note, created_at, expires_at) VALUES (?, ?, 'admin', ?, ?, ?)", [record.id, record.hash, record.note, FAKE_NOW, FAKE_NOW + TOKEN_MS]);

      return token;
    },
    settings: () => database.readSettings(),
  };
}
