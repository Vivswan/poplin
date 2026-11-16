// Making the keys poplin keeps: API tokens the account owns, made with a token a person pasted, and handed to the one change that writes them onto the Worker.
//
//   1  list the account's permission groups     every right of a key found by its name, or that key is not made
//   2  create each token, sent once             Cloudflare answers its value this once
//   3  keep(made)                               the caller writes every new key onto the Worker, in one change
//   4  the write failed: delete the new tokens  no key is left that nothing holds
//   5  the write worked: list the tokens        every other one of a new key's name is an old key
//   6  delete the old keys                      an account never gathers dead keys
//
// A value goes to its key's own `text` and nowhere else, and what that writes goes to `keep` alone: no answer of this file holds either, nothing here logs, and what a failed write quotes of Cloudflare has them taken out.
// A write that fails is taken as not made. Should Cloudflare have made it all the same, the Worker holds deleted keys, which the next check reads as refused and the next repair replaces.

import { BasePermissionGroups } from "cloudflare/resources/accounts/tokens/permission-groups";
import { BaseTokens } from "cloudflare/resources/accounts/tokens/tokens";
import { type CloudflareFailure, type Connection, callCloudflare } from "../client";
import { reportOf, type SyncFailure, type Synced } from "../sync";
import { type KeyPolicies, type ListedGroup, noGroup } from "./rights";

/** What stands where a key was in a text Cloudflare sent. */
const HIDDEN = "[key]";

/** What a write that ended with an exception is said to have failed with: the exception's own text is not passed on. */
const CUT_SHORT = "the change of the Worker's settings was cut short";

/** One key to make: the name every key of its kind has at Cloudflare, what writes its policies from the groups Cloudflare lists, and what writes the text the install keeps of it. */
export interface WantedKey {
  readonly name: string;
  readonly policies: (groups: readonly ListedGroup[]) => KeyPolicies;
  readonly text: (made: MadeKey) => Promise<KeptText>;
}

/** What the install keeps of a new key: the `text` that is written, and every part of it that is as secret as the key's value, which no failure may quote. */
interface KeptText {
  readonly text: string;
  readonly secrets: readonly string[];
}

/** A key Cloudflare made: its id there, and its value, which is answered once. */
interface MadeKey {
  readonly id: string;
  readonly value: string;
}

/** What writes the texts of the new keys onto the Worker, in one change: each text with the wanted key it is of. */
type Keep<Key> = (texts: readonly { readonly key: Key; readonly text: string }[]) => Promise<Synced>;

/** A wanted key Cloudflare made a token for. */
interface Made<Key> {
  readonly key: Key;
  readonly token: MadeKey;
}

/** Why no key was made: a call was refused or unanswered, Cloudflare lists no group for a right, whose names `message` holds, or its answer to the new token named no id or no value. */
type NotMade = CloudflareFailure | { readonly ok: false; readonly failure: "no-group" | "no-value"; readonly message: string };

/**
 * What making one key came to.
 *
 * Made and kept: `kept` is what the write answered, and `stale` says that an older key of the name may be left: the tokens could not be listed, or one could not be deleted.
 * Not made: `made` is false, and the write never saw this key.
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

/** Delete every token of each new key's name but the key itself, ended ones included. Each answer is `false` when a token of that name may be left: the list failed in any way, or a token could not be deleted. */
async function removeOthers(connection: Connection, accountId: string, kept: readonly { readonly name: string; readonly id: string }[]): Promise<boolean[]> {
  try {
    const listed = await callCloudflare(connection, (api) => Array.fromAsync(new BaseTokens(api).list({ account_id: accountId, include_expired: true })));
    if (!listed.ok) return kept.map(() => false);

    return await Promise.all(
      kept.map(async ({ name, id }) => {
        const others = listed.value.filter((token) => token.name === name && token.id !== id);
        const ids = others.flatMap((other) => other.id ?? []);

        return (await removeKeys(connection, accountId, ids)) && ids.length === others.length;
      }),
    );
  } catch {
    return kept.map(() => false);
  }
}

/** A failed write with every key taken out of each text Cloudflare or the connection put into it. */
function withoutKeys(failure: SyncFailure, values: readonly string[]): SyncFailure {
  const hidden = (text: string): string => values.reduce((said, value) => said.replaceAll(value, HIDDEN), text);
  if (failure.failure === "refused") return { ...failure, errors: failure.errors.map(({ code, message }) => ({ code, message: hidden(message) })) };

  if (failure.failure === "network") return { ...failure, message: hidden(failure.message) };

  return failure;
}

/** Hand the text of each new key to the caller's write. An exception is a failed write, and its text stays here. */
async function kept<Key extends WantedKey>(keep: Keep<Key>, made: readonly Made<Key>[]): Promise<Synced> {
  try {
    const texts = await Promise.all(made.map(async ({ key, token }) => ({ key, ...(await key.text(token)) })));
    const written = await keep(texts.map(({ key, text }) => ({ key, text })));
    if (written.ok) return written;

    return withoutKeys(written, [...made.map(({ token }) => token.value), ...texts.flatMap(({ text, secrets }) => [text, ...secrets])]);
  } catch {
    return { ok: false, failure: "network", message: CUT_SHORT, report: reportOf([]) };
  }
}

/** Make one token. A create that is tried again makes a second token, and only the last one's id comes back: this call is sent once. */
async function create(connection: Connection, accountId: string, wanted: WantedKey, groups: readonly ListedGroup[]): Promise<MadeKey | NotMade> {
  const { name } = wanted;
  const policies = wanted.policies(groups);
  if (!policies.ok) return noGroup(policies.missing);

  const created = await callCloudflare(connection, (api) => new BaseTokens(api).create({ account_id: accountId, name, policies: policies.policies }, { maxRetries: 0 }));
  if (!created.ok) return created;

  const { id, value } = created.value;
  if (id !== undefined && value !== undefined && value !== "") return { id, value };

  const left = id === undefined || !(await remove(connection, accountId, id));

  return { ok: false, failure: "no-value", message: left ? `Cloudflare answered no key, and a token named ${name} may be left there` : "Cloudflare answered no key" };
}

/**
 * Make new keys for an install and have them written in one change.
 *
 * @param connection - carries the token of the person who makes the keys, which needs the right to make account tokens
 * @param wanted - the keys to make, each made on its own: one that cannot be made leaves the others as they are
 * @param keep - writes the text of each new key where the install reads it; it never runs when no key was made. A value is seen by its key's own `text` alone
 * @returns each wanted key with what was done with it, in their order, by the table at the top of this file. Keys that were not kept are deleted before this answers, and every older key of a kept key's name once the new ones are kept
 */
export async function mintKeys<Key extends WantedKey>(connection: Connection, accountId: string, wanted: readonly Key[], keep: Keep<Key>): Promise<{ readonly key: Key; readonly minted: Minted }[]> {
  const groups = await callCloudflare(connection, (api) => Array.fromAsync(new BasePermissionGroups(api).list({ account_id: accountId })));
  if (!groups.ok) return wanted.map((key) => ({ key, minted: { ok: false, made: false, why: groups } }));

  const tried: { readonly key: Key; readonly token: MadeKey | NotMade }[] = [];
  for (const key of wanted) {
    // An answer that breaks off is that key not made: the keys made before it are still written, or deleted again. Its own token, should Cloudflare have made one, goes when the next key of the name is kept.
    const token = await create(connection, accountId, key, groups.value).catch((): NotMade => ({ ok: false, failure: "no-value", message: `the answer about the new key was cut short, and a token named ${key.name} may be left there` }));
    tried.push({ key, token });
  }

  const unmade = (why: NotMade): Minted => ({ ok: false, made: false, why });
  const made = tried.flatMap(({ key, token }): Made<Key>[] => ("id" in token ? [{ key, token }] : []));
  if (made.length === 0) return tried.flatMap(({ key, token }) => ("id" in token ? [] : [{ key, minted: unmade(token) }]));

  const written = await kept(keep, made);
  // The other keys are listed only once the new ones are kept, so one a failed create left behind on an earlier run goes with them.
  const named = made.map(({ key, token }) => ({ name: key.name, id: token.id }));
  const settled = written.ok ? await removeOthers(connection, accountId, named) : await Promise.all(named.map(({ id }) => remove(connection, accountId, id)));
  const clean = new Map(named.map(({ id }, index) => [id, settled[index] === true]));

  return tried.map(({ key, token }) => {
    if (!("id" in token)) return { key, minted: unmade(token) };

    const minted: Minted = written.ok ? { ok: true, kept: written, stale: clean.get(token.id) !== true } : { ok: false, made: true, kept: written, left: clean.get(token.id) !== true };

    return { key, minted };
  });
}
