// The account's free address: its own name at `workers.dev`, which Cloudflare calls its subdomain. A new account has none.
//
//   GET  /accounts/{id}/workers/subdomain    the name; refused with code 10007 in an account that has none
//   PUT  /accounts/{id}/workers/subdomain    gives the account its name; refused with code 10031 for a name that is taken
//
// Cloudflare takes no cron trigger in an account that has none, also for a Worker that answers under a domain. So an install of either kind makes it, before anything else.
// Cloudflare's API reference lists no code of either call: the two here are the ones its own command line reads them by.
// Nothing here changes a name an account has: its other Workers answer under it.

import { BaseSubdomains } from "cloudflare/resources/workers/subdomains";
import { type CloudflareFailure, type CloudflareResult, type Connection, callCloudflare } from "../../client";

/** The error code of a read of the name in an account that has none. */
const NONE = 10_007;

/** The error code of a name Cloudflare gives no account: another has it, or it is kept back. */
const TAKEN = 10_031;

/** What the row of the account's free address is called, in an install and in a removal: short enough for the column of a row's object, so that the row lines up with the others. */
export const SUBDOMAIN_ROW = "Account subdomain";

/** A name that was made, one Cloudflare gives no account, or the failure of the call. */
type Made = { readonly ok: true } | { readonly ok: false; readonly failure: "taken" } | CloudflareFailure;

/** Whether Cloudflare refused a call with one error code among its errors. */
function refusedWith(failure: CloudflareFailure, code: number): boolean {
  return failure.failure === "refused" && failure.errors.some((error) => error.code === code);
}

/**
 * Read the account's name at `workers.dev`.
 *
 * @returns the name; `undefined` for an account that has none; a refusal for any other reason is a value
 */
export async function readFreeAddress(connection: Connection, accountId: string): Promise<CloudflareResult<string | undefined>> {
  const read = await callCloudflare(connection, (api) => new BaseSubdomains(api).get({ account_id: accountId }));
  if (!read.ok) return refusedWith(read, NONE) ? { ok: true, value: undefined } : read;

  // An answer that holds no name is an account with none, as the refusal is.
  const name: unknown = read.value.subdomain;

  return { ok: true, value: typeof name === "string" && name !== "" ? name : undefined };
}

/**
 * Give an account that has none its name at `workers.dev`.
 *
 * @param name - the name, checked before it comes here
 * @returns `taken` for a name Cloudflare gives no account, where nothing was made; any other refusal is a value
 */
export async function makeFreeAddress(connection: Connection, accountId: string, name: string): Promise<Made> {
  const made = await callCloudflare(connection, (api) => new BaseSubdomains(api).update({ account_id: accountId, subdomain: name }));
  if (made.ok) return { ok: true };

  return refusedWith(made, TAKEN) ? { ok: false, failure: "taken" } : made;
}
