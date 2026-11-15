// The address that starts a rebuild of the install: saved, removed, and reported by an admin. It is a credential, so no answer of these actions holds it.

import * as v from "valibot";

import type { Actor } from "../auth/scopes";
import { rebuildAddress } from "../records/update";
import { type Install, type Refused, refuse } from "./records";

/** What a request to save the address sends. */
export const UPDATE_ADDRESS_REQUEST = v.strictObject({ address: v.string() });

/** Whether an address is saved, and since when in milliseconds since the epoch; `since` is `null` while none is. */
interface UpdateAddressState {
  readonly ok: true;
  readonly set: boolean;
  readonly since: number | null;
}

/**
 * Say whether an address that starts a rebuild is saved.
 *
 * @returns the state, or `not_allowed` for anyone but an admin
 */
export async function updateAddressState(install: Pick<Install, "database">, actor: Actor): Promise<UpdateAddressState | Refused<"not_allowed">> {
  if (actor.scope !== "admin") return refuse("not_allowed");

  const kept = await install.database.readUpdateAddress();

  return { ok: true, set: kept !== undefined, since: kept?.since ?? null };
}

/**
 * Save the address that starts a rebuild, in place of one saved before. It writes one `update_address_set` audit entry, which holds nothing of the address.
 *
 * @param typed - the address as it was typed
 * @param accepts - whether the host's provider starts rebuilds at an address
 * @returns the state after it, `not_allowed` for anyone but an admin, or `bad_argument` about `address` for one that is not `https` or that the provider does not take; nothing is sent to it either way
 */
export async function saveUpdateAddress(
  install: Pick<Install, "database" | "now">,
  actor: Actor,
  typed: string,
  accepts: (address: URL) => boolean,
): Promise<UpdateAddressState | Refused<"not_allowed" | "bad_argument">> {
  if (actor.scope !== "admin") return refuse("not_allowed");

  const address = rebuildAddress(typed, accepts);
  if (address === undefined) return refuse("bad_argument", "address");

  const at = install.now();
  await install.database.keepUpdateAddress(address, { by: actor.holder, at });

  return { ok: true, set: true, since: at };
}

/**
 * Remove the saved address. It writes one `update_address_removed` audit entry, only when one was saved.
 *
 * @returns the state after it, or `not_allowed` for anyone but an admin
 */
export async function removeUpdateAddress(install: Pick<Install, "database" | "now">, actor: Actor): Promise<UpdateAddressState | Refused<"not_allowed">> {
  if (actor.scope !== "admin") return refuse("not_allowed");

  await install.database.forgetUpdateAddress({ by: actor.holder, at: install.now() });

  return { ok: true, set: false, since: null };
}
