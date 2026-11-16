// Sign everyone out: a new stored key, so every visitor's limit starts again. Tokens are untouched, and no login ends.

import type { Actor } from "../auth/scopes";
import { type Install, type Refused, refuse } from "./records";

/** How many bytes the new key holds. */
const KEY_BYTES = 32;

/**
 * Replace the install's stored key with 32 bytes drawn here from Web Crypto. The key is told to nobody, and the change writes one `signed_everyone_out` audit entry.
 *
 * @returns done, or `not_allowed` for anyone but an admin
 * @throws {Error} the database failed
 */
export async function signEveryoneOut(install: Install, actor: Actor): Promise<{ readonly ok: true } | Refused<"not_allowed">> {
  if (actor.scope !== "admin") return refuse("not_allowed");

  await install.database.rotateVisitorKey(crypto.getRandomValues(new Uint8Array(KEY_BYTES)), { by: actor.holder, at: install.now() });

  return { ok: true };
}
