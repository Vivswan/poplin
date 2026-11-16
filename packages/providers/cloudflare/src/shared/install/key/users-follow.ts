// The users carried to Cloudflare with the key poplin keeps: the policy that lets the logins through is written, then the budget alert is sent to the first of them, where the account has one.
//
//   the policy          every login, under "Access: Apps and Policies Write"   an account with no such policy answers `not_made`, and nothing is written
//   the budget alert    the first login, under "Notifications Write"           an account with no such alert is left with none
//
// No application is read or changed, and no answer carries the key or a text Cloudflare sent.

import type { UsersFollow } from "@poplin/app/src/console/access/users-follow";
import { writeLogins } from "../pieces/access/access";
import { sendBudgetAlertTo } from "../pieces/alerts/budget-alert";
import { type KeptKey, keyed } from "./kept-key";

/** Cloudflare's name of the right the policy is written under. */
const POLICY_RIGHT = "Access: Apps and Policies Write";

/** Cloudflare's name of the right the alert is read and written under. */
const ALERT_RIGHT = "Notifications Write";

/**
 * Make the install's way to carry its users to Cloudflare.
 *
 * @param key - the kept key, or `undefined` on an install that holds none, which answers every try `no_key` and calls nothing
 * @param accountId - the account the policy and the alert are in
 * @returns the users' side at Cloudflare. A try is done only when the policy and the alert both took it: one that stopped at the alert has written the policy
 */
export function createUsersFollow(key: KeptKey | undefined, accountId: string): UsersFollow {
  return {
    where: "Cloudflare",

    holdsKey: () => key !== undefined,

    async push(logins) {
      const [first] = logins;
      const written = await keyed(key, POLICY_RIGHT, (connection) => writeLogins(connection, accountId, logins));
      if (!written.ok) return { ok: false, refusal: written.refusal };

      if (!written.value) return { ok: false, refusal: "not_made" };

      if (first === undefined) return { ok: true };

      const sent = await keyed(key, ALERT_RIGHT, (connection) => sendBudgetAlertTo(connection, accountId, first));

      return sent.ok ? { ok: true } : { ok: false, refusal: sent.refusal, written: true };
    },
  };
}
