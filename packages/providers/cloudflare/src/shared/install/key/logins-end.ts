// Every login of the dashboard ended at Cloudflare with the key poplin keeps: Access takes back each token of poplin's guarded application.
//
//   Access took the request                done; the edge asks every browser to log in again within some seconds
//   the account has no such application    not_made, and nothing is asked
//   the key is absent, refused, lacks      the key's own refusal
//   the right, or no answer came
//
// One person's logins are not ended here: that call needs a right the key is not made with. No answer carries the key or a text Cloudflare sent.

import type { EndLogins } from "@poplin/core/src/actions/sign-out";
import { revokeLogins } from "../pieces/access/access";
import { type KeptKey, keyed } from "./kept-key";

/** Cloudflare's name of the right the tokens are taken back under. */
const REVOKE_RIGHT = "Access: Apps and Policies Write";

/**
 * Make the install's way to end every login of its dashboard.
 *
 * @param key - the kept key, or `undefined` on an install that holds none, which answers `no_key` and calls nothing
 * @param accountId - the account the application is in
 */
export function createEndLogins(key: KeptKey | undefined, accountId: string): EndLogins {
  return async () => {
    const revoked = await keyed(key, REVOKE_RIGHT, (connection) => revokeLogins(connection, accountId));
    if (!revoked.ok) return { ok: false, refusal: revoked.refusal };

    return revoked.value ? { ok: true } : { ok: false, refusal: "not_made" };
  };
}
