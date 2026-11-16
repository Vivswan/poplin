// What an instance reads from the database and then holds: the settings, and the secret made from the stored visitor key.
//
// A new visitor key therefore restarts every visitor's minute.

import { type Logins, parseLogins } from "@poplin/core/src/auth/logins";
import type { Database, SettingsAndKey } from "@poplin/core/src/database/database";
import type { SettingValues } from "@poplin/core/src/records/settings";

/** How long a site request trusts the settings and the logins an instance read. */
export const SETTINGS_LIFETIME_MS = 60_000;

/** What marks the key made for the visitor limit. A new label would start every visitor's minute anew and break nothing. */
const VISITOR_LABEL = "poplin visitor key";

/** The key the visitor limit hashes addresses with. */
const VISITOR_KEY = { name: "HMAC", hash: "SHA-256", length: 256 } as const;

/** Writes a label as the bytes a derivation takes. */
const ENCODER = new TextEncoder();

/** The values an instance holds between reads. */
export interface Held {
  /** Every setting of the install. */
  readonly settings: SettingValues;

  /** The emails allowed in. */
  readonly logins: Logins;

  /** Hashes a visitor's network for the per-visitor limit. It is derived from the visitor key, so nothing more is stored. */
  readonly visitorSecret: CryptoKey;
}

/** The settings and keys a site request is answered with, as its instance holds them. */
export interface SiteHeld {
  /** What the instance read within the minute; `undefined` once that ran out. */
  readonly current: () => Promise<Held> | undefined;

  /** Reads the settings and the key anew, unless the instance read them within the minute. */
  readonly read: () => Promise<Held>;

  /** What the request holds from a lookup that reads the settings and the key beside its site; the instance keeps it too, unless it has read since `at`, the moment the lookup began. It rejects as a read of them or as the lookup does. */
  readonly fromLookup: (read: Promise<SettingsAndKey | undefined>, at: number) => Promise<Held>;
}

/** What one instance holds of the database between reads, and how a request gets at it. */
interface Holding {
  /** What the instance holds, read anew when it is older than `lifetime` milliseconds. */
  readonly held: (database: Database, lifetime: number) => Promise<Held>;

  /** The same for a site request, which trusts a read of the last minute and may bring a newer one itself. */
  readonly ofSite: (database: Database) => SiteHeld;
}

/** How a secret is derived from the visitor key: HKDF with SHA-256, no salt, and the label as its info. */
function derivation(label: string): HkdfParams {
  return { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(), info: ENCODER.encode(label) };
}

/**
 * Derive the secret an instance keeps from the stored visitor key.
 *
 * @param key - the bytes of the install's visitor key
 * @returns the key that hashes a visitor's address for the limits
 */
async function derivedSecret(key: Uint8Array<ArrayBuffer>): Promise<Pick<Held, "visitorSecret">> {
  const derivable = await crypto.subtle.importKey("raw", key, "HKDF", false, ["deriveKey"]);

  return { visitorSecret: await crypto.subtle.deriveKey(derivation(VISITOR_LABEL), derivable, VISITOR_KEY, false, ["sign"]) };
}

/**
 * Make what an instance holds from the settings and the visitor key one read gave.
 *
 * @throws {Error} the install holds no settings or no visitor key, or its logins are refused
 */
async function heldFrom({ settings, key }: SettingsAndKey): Promise<Held> {
  if (settings === undefined || key === undefined) throw new Error("the install holds no settings or no visitor key");

  const logins = parseLogins(settings.logins);
  if (!logins.ok) throw new Error(`the stored logins are refused: ${logins.refusal}`);

  return { settings, logins: logins.value, ...(await derivedSecret(key)) };
}

/**
 * Read the settings and the visitor key, as one question to the database.
 *
 * @throws {Error} the install holds no settings or no visitor key, or the database failed
 */
async function readHeld(database: Pick<Database, "readSettingsAndKey">): Promise<Held> {
  return heldFrom(await database.readSettingsAndKey());
}

/**
 * Make what one instance holds between reads.
 *
 * @param now - the clock, in milliseconds since the epoch
 * @param lost - told when a read fails: the install may have lost its settings or its key, and nothing is held any more
 */
export function createHolding(now: () => number, lost: () => void): Holding {
  let holding: { readonly at: number; readonly value: Promise<Held> } | undefined;

  async function kept(read: Promise<Held>): Promise<Held> {
    try {
      return await read;
    } catch (error) {
      holding = undefined;
      lost();

      throw error;
    }
  }

  function held(database: Database, lifetime: number): Promise<Held> {
    const at = now();
    if (holding === undefined || at - holding.at >= lifetime) holding = { at, value: kept(readHeld(database)) };

    return holding.value;
  }

  // What a lookup brings is as old as the moment the lookup began, and never takes the place of a later read.
  function keep(database: Database, read: Promise<SettingsAndKey | undefined>, at: number): Promise<Held> {
    const value = kept(read.then((brought) => (brought === undefined ? readHeld(database) : heldFrom(brought))));
    if (holding === undefined || at > holding.at) holding = { at, value };

    return value;
  }

  const ofSite = (database: Database): SiteHeld => ({
    current: () => (holding !== undefined && now() - holding.at < SETTINGS_LIFETIME_MS ? holding.value : undefined),
    read: () => held(database, SETTINGS_LIFETIME_MS),
    fromLookup: (read, at) => keep(database, read, at),
  });

  return { held, ofSite };
}
