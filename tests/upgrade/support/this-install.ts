// An install of this checkout's code, wired from the pieces a host wires: the database's doorway, the API, and serving. It opens over a database and a store that another version's code may have filled.

import { createApi } from "../../../packages/app/src/api/api";
import { MemoryCounters } from "../../../packages/app/src/limits/memory-counters";
import { hostnameAddresses } from "../../../packages/app/src/sites/hostname-addresses";
import { serveSite } from "../../../packages/app/src/sites/serve";
import { issueToken } from "../../../packages/core/src/actions/manage-tokens";
import type { Install } from "../../../packages/core/src/actions/records";
import type { SelfUpdate } from "../../../packages/core/src/actions/start-update";
import { type Login, parseLogins } from "../../../packages/core/src/auth/logins";
import type { SqlDriver } from "../../../packages/core/src/database/driver";
import { openDatabase } from "../../../packages/core/src/database/open";
import { parseHostname } from "../../../packages/core/src/names/hostname";
import { DEFAULT_PUBLIC_WORD } from "../../../packages/core/src/names/marker";
import { defaultSettings } from "../../../packages/core/src/records/settings";
import { MemoryStore } from "../../../packages/core/src/storage/memory";
import { type ObjectStore, parseObjectKey } from "../../../packages/core/src/storage/storage";
import { BunSqliteDriver } from "../../../packages/core/tests/database/support/bun-sqlite-driver";
import { type StoredObject, VERSION } from "./seeded-install";

/** The invented domain every install of the check sits under: the one a tree's preview gives its own. */
const DOMAIN = "example.com";

/** The invented person a new install is set up by. */
const ADMIN_EMAIL = "mira@example.com";

/** The bytes of a visitor key. */
const KEY_BYTES = 32;

/** What one request to the API may carry. */
const API_LIMITS = { fileBytes: 100_000_000, files: 10_000, manifestBytes: 2_000_000 } as const;

/** The stand-in for a host's update: it holds its key, as a tree's own preview does, and no release is out for it to take. */
const UPDATE: SelfUpdate = { holdsKey: () => true, ready: async () => ({ ok: false, code: "no_update" }) };

/** An install of this code, running. */
export interface Running {
  /** The database, with every pending step applied. */
  readonly driver: SqlDriver;

  /** The install's actions work on this. */
  readonly install: Install;

  /** The API, at `/api` of any origin. */
  readonly api: (request: Request) => Promise<Response>;

  /** What a logged-in visitor gets at a path of a site's hostname, named by its first host label. */
  readonly served: (hostLabel: string, path: string) => Promise<Response>;
}

/** An install of this code, or why this code cannot use the database. */
type Opened = { readonly ok: true; readonly running: Running } | { readonly ok: false; readonly why: string };

function addresses(): ReturnType<typeof hostnameAddresses> {
  const domain = parseHostname(DOMAIN);
  if (!domain.ok) throw new Error(`the check's domain was refused: ${domain.refusal}`);

  return hostnameAddresses({ domain: domain.value, publicWord: DEFAULT_PUBLIC_WORD });
}

function admin(): Login {
  const logins = parseLogins([ADMIN_EMAIL]);
  const [holder] = logins.ok ? logins.value : [];
  if (holder === undefined) throw new Error("the check's login was refused");

  return holder;
}

/**
 * Open an install of this code over a database and a store.
 *
 * @returns the running install, with the database's pending steps applied; or the doorway's own words for a database it refuses or cannot bring up to date
 */
export async function openInstall(driver: SqlDriver, store: ObjectStore): Promise<Opened> {
  const layout = addresses();
  const now = (): number => Date.now();
  const opened = await openDatabase(driver, now());
  if (opened.kind !== "open") return { ok: false, why: opened.message };

  const { database } = opened;
  const install: Install = { database, store, now, addressOf: layout.addressOf, publicAddressOf: layout.publicAddressOf, reservedNames: layout.reservedNames };
  const counted = { counters: new MemoryCounters(), visitorOf: async () => "local" };
  const api = createApi({ ...install, ...counted, readToken: (id) => database.getToken(id), limits: API_LIMITS, version: VERSION, layout: { kind: "hostname", public_word: DEFAULT_PUBLIC_WORD }, update: UPDATE });

  const served: Running["served"] = async (hostLabel, path) => {
    const settings = await database.readSettings();
    if (settings === undefined) throw new Error("the install holds no settings");

    return serveSite(new Request(`https://${hostLabel}.${DOMAIN}${path}`), {
      database,
      store,
      settings,
      addresses: layout,
      identify: async () => ({ ok: true }),
      now,
    });
  };

  return { ok: true, running: { driver, install, api: api.fetch, served } };
}

/**
 * Make a new install of this code that holds no site.
 *
 * @returns the running install and a token of its admin
 * @throws {Error} this code cannot open a database it made itself
 */
export async function newInstall(): Promise<Running & { readonly token: string }> {
  const opened = await openInstall(new BunSqliteDriver(), new MemoryStore());
  if (!opened.ok) throw new Error(`a new database did not open: ${opened.why}`);

  const { install } = opened.running;
  const holder = admin();
  await install.database.initSettings(defaultSettings({ installer: holder }), { as: "first_login", by: holder, at: install.now() });
  await install.database.ensureVisitorKey(crypto.getRandomValues(new Uint8Array(KEY_BYTES)), install.now());
  const issued = await issueToken(install, { scope: "admin", holder }, { note: "upgrade check", scope: "admin" });
  if (!issued.ok) throw new Error(`the new install issued no token: ${issued.code}`);

  return { ...opened.running, token: issued.token };
}

/**
 * Put objects into a new store of this code, each under the key and with the content type it was kept with.
 *
 * @throws {Error} a key is one this code's store takes no object under
 */
export async function storeOf(objects: readonly StoredObject[]): Promise<ObjectStore> {
  const store = new MemoryStore();

  for (const { key, bytes, contentType } of objects) {
    const parsed = parseObjectKey(key);
    if (!parsed.ok) throw new Error(`this code's store refuses the key ${key}: ${parsed.refusal}`);

    await store.write(parsed.key, bytes, { contentType });
  }

  return store;
}
