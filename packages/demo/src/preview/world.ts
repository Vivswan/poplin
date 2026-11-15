// One install held in memory for the demo: the database over a SQL driver the host hands in, the memory store, a clock the seed can set, and one sample admin.
//
// Nothing here names a runtime: the host that starts the demo brings the driver, so the same install opens under bun, in a Worker, or in a browser.

import { MemoryCounters } from "../../../app/src/limits/memory-counters";
import { hostnameAddresses } from "../../../app/src/sites/hostname-addresses";
import type { Install } from "../../../core/src/actions/records";
import { type Login, parseLogins } from "../../../core/src/auth/logins";
import type { Actor } from "../../../core/src/auth/scopes";
import type { SqlDriver } from "../../../core/src/database/driver";
import { openDatabase } from "../../../core/src/database/open";
import { parseHostname } from "../../../core/src/names/hostname";
import { DEFAULT_PUBLIC_WORD } from "../../../core/src/names/marker";
import { defaultSettings } from "../../../core/src/records/settings";
import { MemoryStore } from "../../../core/src/storage/memory";
import type { ObjectStore } from "../../../core/src/storage/storage";

/** The invented domain the demo's install sits under. */
export const DOMAIN = "example.com";

/** The invented person every demo page is shown to. */
const ADMIN_EMAIL = "mira@example.com";

/** The title of the demo's dashboards, where a real install starts with the hostname of its dashboard. */
const DASHBOARD_TITLE = "poplin";

/** The bytes of a signing key and of a forms secret. */
const KEY_BYTES = 32;

/** A clock that follows the machine's own unless the seed holds it at one moment. */
interface Clock {
  held?: number;
}

/** What a host that keeps the demo across its own restarts hands an install; each is made anew when left out. */
interface Kept {
  /** The object store, which the host can save. */
  readonly store?: ObjectStore;

  /** The bytes that sign the forms' tokens. */
  readonly csrfSecret?: Uint8Array<ArrayBuffer>;

  /** When the install was set up, in milliseconds since the epoch: now when left out. A seeded install was set up before its sample history began. */
  readonly since?: number;
}

/** One demo install and what is built around it. */
export interface World {
  /** The install the actions work on. */
  readonly install: Install;

  /** The sample admin, as a person behind a session. */
  readonly admin: Actor & { readonly holder: Login };

  /** The clock of the install: `held` set, every action happens at that moment. */
  readonly clock: Clock;

  /** The request counts of the limits, the login codes, and the setup page. */
  readonly counters: MemoryCounters;

  /** The bytes that sign the forms' tokens. */
  readonly csrfSecret: Uint8Array<ArrayBuffer>;
}

function layout(): ReturnType<typeof hostnameAddresses> {
  const domain = parseHostname(DOMAIN);
  if (!domain.ok) throw new Error(`the demo's domain was refused: ${domain.refusal}`);

  return hostnameAddresses({ domain: domain.value, publicWord: DEFAULT_PUBLIC_WORD });
}

/** The address layout of the demo's installs: the product's own, under the invented domain. */
export const ADDRESSES = layout();

/**
 * Open a fresh install with the default settings and the sample admin as its one login.
 *
 * @param driver - a SQL database of the host's own, such as SQLite in memory: empty, or holding a demo opened before
 * @param kept - the store and the forms secret of a host that keeps them; a memory store and random bytes when left out
 * @returns the install, with nothing published in an empty database; settings and a signing key that are there already stay as they are
 * @throws {Error} the database did not open
 */
export async function openWorld(driver: SqlDriver, kept: Kept = {}): Promise<World> {
  const clock: Clock = {};
  const now = (): number => clock.held ?? Date.now();
  const opened = await openDatabase(driver, now());
  if (opened.kind !== "open") throw new Error(`the demo's database did not open: ${opened.kind}`);

  const logins = parseLogins([ADMIN_EMAIL]);
  const [holder] = logins.ok ? logins.value : [];
  if (holder === undefined) throw new Error("the demo's login was refused");

  const { database } = opened;
  await database.initSettings(defaultSettings({ installer: holder, hostname: DASHBOARD_TITLE }), { by: holder, at: kept.since ?? now() });
  await database.ensureSigningKey(crypto.getRandomValues(new Uint8Array(KEY_BYTES)), now());

  return {
    install: { database, store: kept.store ?? new MemoryStore(), now, addressOf: ADDRESSES.addressOf, publicAddressOf: ADDRESSES.publicAddressOf, reservedNames: ADDRESSES.reservedNames },
    admin: { scope: "admin", holder },
    clock,
    counters: new MemoryCounters(),
    csrfSecret: kept.csrfSecret ?? crypto.getRandomValues(new Uint8Array(KEY_BYTES)),
  };
}
