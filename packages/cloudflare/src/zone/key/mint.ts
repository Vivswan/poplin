// Making the key poplin keeps: an API token the account owns, made with a token a person pasted, and handed to the one change that writes it onto the Worker.
//
//   1  list the account's permission groups     every right of the key found by its name, or none is made
//   2  create the token, sent once              Cloudflare answers its value this once
//   3  keep(value)                              the caller writes it onto the Worker
//   4  the write failed: delete the new token   no key is left that nothing holds
//   5  the write worked: list the tokens        every other one of the key's name is an old key
//   6  delete the old keys                      an account never gathers dead keys
//
// The value goes to `keep` and nowhere else: no answer of this file holds it, nothing here logs, and what a failed write quotes of Cloudflare has it taken out.
// A write that fails is taken as not made. Should Cloudflare have made it all the same, the Worker holds a deleted key, which the next check reads as refused and the next repair replaces.

import { BasePermissionGroups } from "cloudflare/resources/accounts/tokens/permission-groups";
import { BaseTokens } from "cloudflare/resources/accounts/tokens/tokens";
import { type CloudflareFailure, type Connection, callCloudflare } from "../client";
import { reportOf, type SyncFailure, type Synced } from "../sync";
import { type KeyPlace, keyPolicies, noGroup } from "./rights";

/** What stands where the key was in a text Cloudflare sent. */
const HIDDEN = "[key]";

/** What a write that ended with an exception is said to have failed with: the exception's own text is not passed on. */
const CUT_SHORT = "the change of the Worker's settings was cut short";

/** Why no key was made: a call was refused or unanswered, Cloudflare lists no group for a right, whose names `message` holds, or its answer to the new token named no id or no value. */
type NotMade = CloudflareFailure | { readonly ok: false; readonly failure: "no-group" | "no-value"; readonly message: string };

/**
 * What making a key came to.
 *
 * Made and kept: `kept` is what the write answered, and `stale` says that an older key of the name may be left: the tokens could not be listed, or one could not be deleted.
 * Not made: `made` is false, nothing was written, and `keep` never ran.
 * Made and not kept: `kept` is the write's failure, and `left` says that the new key could not be deleted and is still at Cloudflare.
 */
export type Minted =
  | { readonly ok: true; readonly kept: Extract<Synced, { readonly ok: true }>; readonly stale: boolean }
  | { readonly ok: false; readonly made: false; readonly why: NotMade }
  | { readonly ok: false; readonly made: true; readonly kept: SyncFailure; readonly left: boolean };

/** Delete one token of the account. A failure of any kind is `false`: the caller says what is left. */
async function remove(connection: Connection, accountId: string, id: string): Promise<boolean> {
  try {
    return (await callCloudflare(connection, (api) => new BaseTokens(api).delete(id, { account_id: accountId }))).ok;
  } catch {
    return false;
  }
}

/**
 * Delete tokens of the account that no install holds.
 *
 * @returns `false` when one may be left: a token could not be deleted
 */
export async function removeKeys(connection: Connection, accountId: string, ids: readonly string[]): Promise<boolean> {
  const removed = await Promise.all(ids.map((id) => remove(connection, accountId, id)));

  return !removed.includes(false);
}

/** Delete every token of the key's name but the one just kept, ended ones included. `false` when one may be left: the list failed in any way, or a token could not be deleted. */
async function removeOthers(connection: Connection, place: KeyPlace & { readonly name: string }, keptId: string): Promise<boolean> {
  try {
    const listed = await callCloudflare(connection, (api) => Array.fromAsync(new BaseTokens(api).list({ account_id: place.accountId, include_expired: true })));
    if (!listed.ok) return false;

    const others = listed.value.filter((token) => token.name === place.name && token.id !== keptId);
    const ids = others.flatMap((other) => other.id ?? []);
    const removed = await removeKeys(connection, place.accountId, ids);

    return removed && ids.length === others.length;
  } catch {
    return false;
  }
}

/** A failed write with the key taken out of every text Cloudflare or the connection put into it. */
function withoutKey(failure: SyncFailure, value: string): SyncFailure {
  if (failure.failure === "refused") return { ...failure, errors: failure.errors.map(({ code, message }) => ({ code, message: message.replaceAll(value, HIDDEN) })) };

  if (failure.failure === "network") return { ...failure, message: failure.message.replaceAll(value, HIDDEN) };

  return failure;
}

/** Hand the key to the caller's write. An exception is a failed write, and its text stays here. */
async function kept(keep: (value: string) => Promise<Synced>, value: string): Promise<Synced> {
  try {
    const written = await keep(value);

    return written.ok ? written : withoutKey(written, value);
  } catch {
    return { ok: false, failure: "network", message: CUT_SHORT, report: reportOf([]) };
  }
}

/**
 * Make a new key for an install and have it written.
 *
 * @param connection - carries the token of the person who makes the key, which needs the right to make account tokens
 * @param place - where the key acts, and `name`, the name every key of an install has at Cloudflare
 * @param keep - writes the value where the install reads it; it is the only thing that ever sees the value
 * @returns what was done, by the table at the top of this file. A key that was not kept is deleted before this answers, and every older key of the name once the new one is kept
 */
export async function mintKey(connection: Connection, place: KeyPlace & { readonly name: string }, keep: (value: string) => Promise<Synced>): Promise<Minted> {
  const { accountId, name } = place;
  const groups = await callCloudflare(connection, (api) => Array.fromAsync(new BasePermissionGroups(api).list({ account_id: accountId })));
  if (!groups.ok) return { ok: false, made: false, why: groups };

  const wanted = keyPolicies(place, groups.value);
  if (!wanted.ok) return { ok: false, made: false, why: noGroup(wanted.missing) };

  // A create that is tried again makes a second token, and only the last one's id comes back: this call is sent once.
  const created = await callCloudflare(connection, (api) => new BaseTokens(api).create({ account_id: accountId, name, policies: wanted.policies }, { maxRetries: 0 }));
  if (!created.ok) return { ok: false, made: false, why: created };

  const { id, value } = created.value;
  if (id === undefined || value === undefined || value === "") {
    const left = id === undefined || !(await remove(connection, accountId, id));

    return { ok: false, made: false, why: { ok: false, failure: "no-value", message: left ? `Cloudflare answered no key, and a token named ${name} may be left there` : "Cloudflare answered no key" } };
  }

  const written = await kept(keep, value);
  if (!written.ok) return { ok: false, made: true, kept: written, left: !(await remove(connection, accountId, id)) };

  // The other keys are listed only now, so one a failed create left behind on an earlier run goes with them.
  return { ok: true, kept: written, stale: !(await removeOthers(connection, place, id)) };
}
