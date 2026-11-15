// A local install whose database a test also reaches with SQL: the real API on bun's SQLite and a store in memory, for the self-test of what the live harness does to a database directly.

import { createApi } from "../../../packages/app/src/api/api";
import { MemoryCounters } from "../../../packages/app/src/limits/memory-counters";
import { ADDRESSES } from "../../../packages/app/tests/sites/support/layout";
import type { Fetch } from "../../../packages/cli/src/client/client";
import type { Login } from "../../../packages/core/src/auth/logins";
import { mintToken } from "../../../packages/core/src/auth/tokens";
import { openDatabase } from "../../../packages/core/src/database/open";
import { defaultSettings, type SettingValues } from "../../../packages/core/src/records/settings";
import { MemoryStore } from "../../../packages/core/src/storage/memory";
import { BunSqliteDriver } from "../../../packages/core/tests/database/support/bun-sqlite-driver";

/** The moment every request arrives at. */
const NOW = 1_700_000_000_000;

/** How long a token the fake makes is good for, in milliseconds. */
const TOKEN_MS = 60 * 60 * 1000;

/** The hostname the fake's API answers on. */
const ADMIN_HOST = "poplin.example.com";

/** The admin whose settings the install starts with. */
const INSTALLER = "ada@example.com" as Login;

/** What one request can carry: room for the repository's sample sites. */
const LIMITS = { fileBytes: 1_000_000, files: 100, manifestBytes: 100_000 };

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

/**
 * Open a fake install with no site and no token.
 *
 * @throws {Error} the database did not open
 */
export async function openSqlInstall(): Promise<SqlInstall> {
  const driver = new BunSqliteDriver();
  const opened = await openDatabase(driver, NOW);
  if (opened.kind !== "open") throw new Error(`the fake's database did not open: ${opened.kind}`);

  const { database } = opened;
  await database.initSettings(defaultSettings({ installer: INSTALLER, hostname: ADMIN_HOST }), { by: INSTALLER, at: NOW });

  const counters = new MemoryCounters();
  const api = createApi({
    database,
    store: new MemoryStore(),
    now: () => NOW,
    addressOf: ADDRESSES.addressOf,
    publicAddressOf: ADDRESSES.publicAddressOf,
    reservedNames: ADDRESSES.reservedNames,
    readToken: (id) => database.getToken(id),
    limits: LIMITS,
    counters,
    visitorOf: async () => "one-visitor",
  });

  const sql: SqlInstall["sql"] = async (statement, params = []) => (await driver.batch([{ sql: statement, params: [...params] }]))[0]?.rows ?? [];

  return {
    server: `https://${ADMIN_HOST}`,
    fetch: (input, init) => api.fetch(new Request(input, init)),
    sql,
    addToken: async (note) => {
      const { token, record } = await mintToken({ scope: "admin", note, now: NOW });
      await sql("INSERT INTO tokens (id, hash, scope, note, created_at, expires_at) VALUES (?, ?, 'admin', ?, ?, ?)", [record.id, record.hash, record.note, NOW, NOW + TOKEN_MS]);

      return token;
    },
    settings: () => database.readSettings(),
  };
}
