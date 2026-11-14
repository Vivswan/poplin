// What an instance reads from the database and then holds: the settings, and the keys made from the stored signing key.
//
// A new signing key therefore ends every session, restarts every visitor's minute, and voids every open form of the dashboard.

import { importSessionKey } from "@poplin/core/src/auth/cookie";
import { type Logins, parseLogins } from "@poplin/core/src/auth/logins";
import type { Database } from "@poplin/core/src/database/database";
import type { SettingValues } from "@poplin/core/src/records/settings";

/** What marks the key made for the visitor limit. A new label would start every visitor's minute anew and break nothing. */
const VISITOR_LABEL = "poplin visitor key";

/** What marks the bytes made for the dashboard's forms. It differs from the visitor's, so neither secret tells the other. */
const FORMS_LABEL = "poplin dashboard forms";

/** The key the visitor limit hashes addresses with. */
const VISITOR_KEY = { name: "HMAC", hash: "SHA-256", length: 256 } as const;

/** The bits of the secret the dashboard signs its forms with. */
const FORMS_BITS = 256;

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

  /** Signs the tokens of the dashboard's forms. It is derived from the signing key under a label of its own. */
  readonly formsSecret: Uint8Array<ArrayBuffer>;
}

/** How a secret is derived from the signing key: HKDF with SHA-256, no salt, and the label as its info. */
function derivation(label: string): HkdfParams {
  return { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(), info: ENCODER.encode(label) };
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

  const derivable = await crypto.subtle.importKey("raw", key, "HKDF", false, ["deriveKey", "deriveBits"]);
  const visitorSecret = await crypto.subtle.deriveKey(derivation(VISITOR_LABEL), derivable, VISITOR_KEY, false, ["sign"]);
  const formsSecret = new Uint8Array(await crypto.subtle.deriveBits(derivation(FORMS_LABEL), derivable, FORMS_BITS));

  return { settings, logins: logins.value, sessionKey: await importSessionKey(key), visitorSecret, formsSecret };
}
