// Sign everyone out: every login of the dashboard is ended where the logins are kept, and one audit entry says who did it. Tokens are untouched.
//
//   the logins were ended                           done, with one `signed_everyone_out` entry
//   they were not, or the install has no way to     `logins_not_ended`, about the reason; nothing is written

import type { Actor } from "../auth/scopes";
import { signedBy } from "./reach";
import { type Install, type Refused, refuse } from "./records";

/** What a refusal is about on an install that was given no way to end its logins. */
const NO_WAY = "no_provider";

/**
 * Why the logins were not ended: the install holds no key for where they are kept, the key is refused there, the key may not end logins,
 * no usable answer came, or, as `not_made`, the login in front of the dashboard is not there.
 */
type EndRefusal = "no_key" | "key_refused" | "lacks_right" | "unreachable" | "not_made";

/** Ends every login of the dashboard where the logins are kept. It rejects for nothing that place answers. */
export type EndLogins = () => Promise<{ readonly ok: true } | { readonly ok: false; readonly refusal: EndRefusal }>;

/**
 * End every login of the dashboard, and write one `signed_everyone_out` audit entry once they are ended.
 *
 * @param end - ends the logins; `undefined` on an install whose host has no such way
 * @returns done, `not_allowed` for anyone but an admin, or `logins_not_ended` about the reason, which is `no_provider` with no `end`
 * @throws {Error} the database failed, after the logins were ended
 */
export async function signEveryoneOut(install: Install, actor: Actor, end: EndLogins | undefined): Promise<{ readonly ok: true } | Refused<"not_allowed" | "logins_not_ended">> {
  if (actor.scope !== "admin") return refuse("not_allowed");

  if (end === undefined) return refuse("logins_not_ended", NO_WAY);

  const ended = await end();
  if (!ended.ok) return refuse("logins_not_ended", ended.refusal);

  await install.database.appendAudit({ action: "signed_everyone_out", detail: {} }, signedBy(actor, install.now()));

  return { ok: true };
}
