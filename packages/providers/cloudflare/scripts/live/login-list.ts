// The emails Cloudflare's login lets in for the install, read at Cloudflare with the key a live run holds: what a check compares with the users the install was just given.

import { BasePolicies } from "cloudflare/resources/zero-trust/access/policies";

import { type Connection, callCloudflare } from "../../src/zone/client";
import { INSTALL_OBJECTS } from "../../src/zone/install-objects";

/**
 * Read the emails of the policy that lets the install's logins through.
 *
 * @returns every email the policy names, in Cloudflare's order
 * @throws {Error} Cloudflare refused the reading, or the account holds no such policy; the message is one of this file's own, and holds nothing Cloudflare or the connection said
 */
export async function readLoginList(connection: Connection, accountId: string): Promise<readonly string[]> {
  // A reading that ends in an exception is told in this file's words too: what was thrown may quote the request.
  const listed = callCloudflare(connection, (api) => Array.fromAsync(new BasePolicies(api).list({ account_id: accountId })));
  const policies = await listed.catch(() => undefined);
  if (policies === undefined) throw new Error("the login list at Cloudflare could not be read: the reading failed");

  if (!policies.ok) throw new Error(`the login list at Cloudflare could not be read: ${policies.failure}`);

  const held = policies.value.find((policy) => policy.name === INSTALL_OBJECTS.accessPolicy);
  if (held === undefined) throw new Error("the account holds no policy of the install's logins");

  return (held.include ?? []).flatMap((rule) => ("email" in rule ? [rule.email.email] : []));
}
