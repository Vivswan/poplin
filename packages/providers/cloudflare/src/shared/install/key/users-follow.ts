// The users carried to Cloudflare with the key poplin keeps: the policy that lets the users through is written, then the alerts of the install's kind are sent to the first of them.
//
//   the policy    every login, under "Access: Apps and Policies Write"   an account with no such policy answers `not_made`, and nothing is written
//                 written every time: a list read just after a write may still answer the users as they were
//   the alerts    the first login, under "Notifications Write"           an account that lacks one gets it
//                 compared with one list, which may trail a write: a try that wrote none says so, and the install trusts that only of a try made long after the last write
//
// No application is read or changed, and no answer carries the key or a text Cloudflare sent.

import type { UsersFollow } from "@poplin/app/src/console/access/users-follow";
import { writeLogins } from "../pieces/access/access";
import { type AccountAlert, keepAlerts } from "../pieces/alerts/account-alert";
import { type KeptKey, keyed } from "./kept-key";

/** Cloudflare's name of the right the policy is written under. */
const POLICY_RIGHT = "Access: Apps and Policies Write";

/**
 * Make the install's way to carry its users to Cloudflare.
 *
 * @param key - the kept key, or `undefined` on an install that holds none, which answers every try `no_key` and calls nothing
 * @param accountId - the account the policy and the alerts are in
 * @param alerts - the alerts of the install's kind
 * @returns the users' side at Cloudflare. A try is done only when the policy and every alert took it: one that stopped at an alert has written the policy
 */
export function createUsersFollow(key: KeptKey | undefined, accountId: string, alerts: readonly AccountAlert[]): UsersFollow {
  return {
    where: "Cloudflare",

    holdsKey: () => key !== undefined,

    async push(users) {
      const [first] = users;
      const written = await keyed(key, POLICY_RIGHT, (connection) => writeLogins(connection, accountId, users));
      if (!written.ok) return { ok: false, refusal: written.refusal };

      if (!written.value) return { ok: false, refusal: "not_made" };

      if (first === undefined) return { ok: true, stood: true };

      const sent = await keepAlerts(key, accountId, alerts, first);

      return sent.refusal === undefined ? { ok: true, stood: sent.wrote.length === 0 } : { ok: false, refusal: sent.refusal, written: true };
    },
  };
}
