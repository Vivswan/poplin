// What an instance reads from the database and then holds: the settings, and the keys made from the stored signing key.
//
// A new signing key therefore ends every session, restarts every visitor's minute, and voids every open form of the dashboard.

import { importSessionKey } from "@poplin/core/src/auth/cookie";
import { type Logins, parseLogins } from "@poplin/core/src/auth/logins";
import type { Database } from "@poplin/core/src/database/database";
import type { SettingValues } from "@poplin/core/src/records/settings";

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

  /** Signs and checks the session cookie. */
  readonly sessionKey: CryptoKey;

  /** Hashes a visitor's network for the per-visitor limit. It is derived from the signing key, so nothing more is stored. */
  readonly visitorSecret: CryptoKey;
}

/** How a secret is derived from the signing key: HKDF with SHA-256, no salt, and the label as its info. */
function derivation(label: string): HkdfParams {
  return { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(), info: ENCODER.encode(label) };
}

/**
 * Derive the secret an instance keeps beside the session key.
 *
 * @param key - the bytes of the install's signing key
 * @returns the key that hashes a visitor's address for the limits
 */
export async function derivedSecret(key: Uint8Array<ArrayBuffer>): Promise<Pick<Held, "visitorSecret">> {
  const derivable = await crypto.subtle.importKey("raw", key, "HKDF", false, ["deriveKey"]);

  return { visitorSecret: await crypto.subtle.deriveKey(derivation(VISITOR_LABEL), derivable, VISITOR_KEY, false, ["sign"]) };
}

/**
 * Read the settings and the signing key.
 *
 * @throws {Error} the install holds no settings or no signing key, or the database failed
 */
export async function readHeld(database: Pick<Database, "readSettings" | "readSigningKey">): Promise<Held> {
  const [settings, key] = await Promise.all([database.readSettings(), database.readSigningKey()]);
  if (settings === undefined || key === undefined) throw new Error("the install holds no settings or no signing key");

  const logins = parseLogins(settings.logins);
  if (!logins.ok) throw new Error(`the stored logins are refused: ${logins.refusal}`);

  return { settings, logins: logins.value, sessionKey: await importSessionKey(key), ...(await derivedSecret(key)) };
}
