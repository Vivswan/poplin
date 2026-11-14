// Sign everyone out: a new signing key, so every session signed with the old one ends. Tokens are untouched.

import type { Actor } from "../auth/scopes";
import { type Install, type Refused, refuse } from "./records";

/** How many bytes the new signing key holds: the output size of HMAC-SHA-256. */
const KEY_BYTES = 32;

/**
 * Replace the install's signing key with 32 bytes drawn here from Web Crypto. The key is told to nobody, and the change writes one `signed-everyone-out` audit entry.
 *
 * @returns done, or `not_allowed` for anyone but an admin
 * @throws {Error} the database failed
 */
export async function signEveryoneOut(install: Install, actor: Actor): Promise<{ readonly ok: true } | Refused<"not_allowed">> {
  if (actor.scope !== "admin") return refuse("not_allowed");

  await install.database.rotateSigningKey(crypto.getRandomValues(new Uint8Array(KEY_BYTES)), { by: actor.holder, at: install.now() });

  return { ok: true };
}
