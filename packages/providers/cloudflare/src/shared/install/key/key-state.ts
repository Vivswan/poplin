// How the keys of an install stand, read before a check says so or a repair makes new ones.
//
//   the kept key, on the Worker that holds it     the key itself is asked: Cloudflare takes it and names its token by id, or refuses it
//   the upload key, on the Worker that holds it   the Worker holds its id, and Cloudflare lists an active token of that id, or the key is refused; its bucket is read from the Worker's bindings
//   anywhere else, with a person's token          the Worker has the secret, and Cloudflare lists an active token of the key's name
//   a key that stands, any of these ways          its rights are read from the account's tokens, with the person's token: one made before a right was added lacks it
//
// A key answers nothing about its own rights, so they are read from the account's tokens: on the Worker, from the one token whose id the Worker holds or the key answered.
// Every other token of the key's name is then one the Worker does not hold, such as a new key whose write failed: `spare` names them.
// Without the Worker the token it holds cannot be told from another of the name, so the key stands only when every active one carries every right.
// The tokens and the permission groups are listed once for both keys.

import type { Keyed } from "@poplin/app/src/console/key/records";
import { BasePermissionGroups } from "cloudflare/resources/accounts/tokens/permission-groups";
import { BaseTokens } from "cloudflare/resources/accounts/tokens/tokens";
import { type CloudflareFailure, type CloudflareResult, type Connection, callCloudflare } from "../client";
import { INSTALL_OBJECTS } from "../install-objects";
import { type ListedBinding, readBindings } from "../pieces/variables/variables";
import { type Bucket, carriesRights, type KeyPlace, type KeyPolicies, keyPolicies, type ListedGroup, noGroup, uploadKeyPolicies } from "./rights";

/** What the Worker's own key is said to have failed with when Cloudflare gave no usable answer about it. */
const NO_ANSWER: Unread = { ok: false, failure: "network", message: "no answer about the key", read: "tokens" };

/** The two keys, in the order they are read. */
const KINDS = ["kept", "upload"] as const;

/** How a key stands: the install has one that works, has none, has one Cloudflare takes no more, or has one that lacks a right the install uses. */
type KeyState = "present" | "missing" | "refused" | "lacking";

/** A reading that failed, with which of the two it was: the Worker's bindings or the account's tokens. A right Cloudflare lists no group for leaves the tokens unread: no key can be compared with it. */
type Unread = (CloudflareFailure | ReturnType<typeof noGroup>) & { readonly read: "bindings" | "tokens" };

/** What a reading answers. `spare` is the id of every token of the key's name that the Worker is known not to hold. */
export type KeyRead = { readonly ok: true; readonly value: KeyState; readonly spare: readonly string[] } | Unread;

/** Whether the install has a key that works, before its rights are read; `id` is Cloudflare's id of the token, where the Worker holds it or the key itself answered it. */
type Stands = { readonly ok: true; readonly value: Exclude<KeyState, "lacking">; readonly id?: string } | Unread;

/** A key whose rights are read: the name its tokens have at Cloudflare, what writes its policies, where it acts, and whether the key answered for itself, so that its token not being listed leaves it standing. */
interface Sort {
  readonly name: string;
  readonly policies: (place: KeyPlace, groups: readonly ListedGroup[]) => KeyPolicies;
  readonly place: KeyPlace;
  readonly vouched: boolean;
}

/** The Worker whose keys are read, and where the kept key acts. */
type OwnWorker = KeyPlace & { readonly script: string };

/** A token as the account lists it. */
interface ListedToken {
  readonly id?: string;
  readonly name?: string;
  readonly status?: string;
  readonly policies?: Parameters<typeof carriesRights>[2];
}

/** How both keys stand before their rights are read, and the install's bucket where the Worker's bindings were read and name one. */
interface Standing {
  readonly kept: Stands;
  readonly upload: Stands;
  readonly bucket?: Bucket | undefined;
}

/** How both keys stand, and the install's bucket where the Worker's bindings were read and name one. */
interface KeyStates {
  readonly kept: KeyRead;
  readonly upload: KeyRead;
  readonly bucket?: Bucket | undefined;
}

/** A key as the Worker that holds it asks about it. A key that works answers Cloudflare's id of its token, and never its value. */
export interface HeldKey {
  has(): boolean;
  verify(): Promise<Keyed<{ readonly id: string }>>;
}

/** The keys as the Worker that holds them sees them: the kept key, and the id of the upload key's token, `undefined` on a Worker that holds none. */
export interface HeldKeys {
  readonly kept: HeldKey;
  readonly uploadId: string | undefined;
}

/** The kept key's state as the Worker that holds it knows it. */
async function heldState(held: HeldKey): Promise<Stands> {
  if (!held.has()) return { ok: true, value: "missing" };

  const verified = await held.verify();
  if (verified.ok) return { ok: true, value: "present", id: verified.value.id };

  if (verified.refusal === "no_key") return { ok: true, value: "missing" };

  return verified.refusal === "key_refused" ? { ok: true, value: "refused" } : NO_ANSWER;
}

/**
 * Find the install's bucket among the bindings of its Worker.
 *
 * @returns the bucket's name and jurisdiction, or `undefined` for a Worker with no such binding
 */
function bucketOf(bindings: readonly ListedBinding[]): Bucket | undefined {
  const bound = bindings.find((binding) => binding.name === INSTALL_OBJECTS.bucketBinding && binding.type === "r2_bucket");
  if (bound?.bucket_name === undefined) return undefined;

  return { name: bound.bucket_name, jurisdiction: bound.jurisdiction };
}

/** Whether the Worker has each key's secret, and which bucket it is bound to, as a person's token reads its bindings. A Worker that does not exist yet has neither key. */
async function boundStates(connection: Connection, worker: OwnWorker): Promise<Standing> {
  const settings = await readBindings(connection, worker);
  if (!settings.ok) return { kept: { ...settings, read: "bindings" }, upload: { ...settings, read: "bindings" } };

  const bindings = settings.value;
  const bound = (name: string): Stands => ({ ok: true, value: bindings.some((binding) => binding.name === name && binding.type === "secret_text") ? "present" : "missing" });

  return { kept: bound(INSTALL_OBJECTS.keyBinding), upload: bound(INSTALL_OBJECTS.uploadKeyBinding), bucket: bucketOf(bindings) };
}

/** How both keys stand as the Worker that holds them knows it. The bucket an upload key must reach is the one the Worker is bound to now, which only its bindings say. */
async function heldStates(held: HeldKeys, connection: Connection, worker: OwnWorker): Promise<Standing> {
  const kept = await heldState(held.kept);
  if (held.uploadId === undefined) return { kept, upload: { ok: true, value: "missing" } };

  const bucket = await readBucket(connection, worker);
  if (!bucket.ok) return { kept, upload: { ...bucket, read: "bindings" } };

  return { kept, upload: { ok: true, value: "present", id: held.uploadId }, bucket: bucket.value };
}

/** The tokens a key that stands is judged by: the one the Worker holds, or without the Worker every active one of the key's name. A held token that did not answer for itself counts only while it is active. */
function judgedTokens(sort: Sort, tokens: readonly ListedToken[], heldId: string | undefined): ListedToken[] {
  if (heldId === undefined) return tokens.filter((token) => token.name === sort.name && token.status === "active");

  return tokens.filter((token) => token.id === heldId && (sort.vouched || token.status === "active"));
}

/**
 * Read how a key that stands is listed at Cloudflare: whether the token the Worker holds carries every right of the key where the install is.
 *
 * @param tokens - every token of the account, ended ones included
 * @param groups - every permission group Cloudflare lists for the account, or why they could not be listed
 * @param heldId - the id of the token the Worker holds; absent where the reader is not the Worker, and then every active token of the name is judged
 * @returns a held key that answered for itself and is not listed stands: its rights cannot be read. Any other key with no token to judge is one Cloudflare takes no more
 */
function listedState(sort: Sort, tokens: readonly ListedToken[], groups: CloudflareResult<readonly ListedGroup[]>, heldId: string | undefined): KeyRead {
  const judged = judgedTokens(sort, tokens, heldId);
  const spare = heldId === undefined ? [] : tokens.flatMap((token) => (token.name !== sort.name || token.id === undefined || token.id === heldId ? [] : [token.id]));
  if (judged.length === 0) return { ok: true, value: heldId !== undefined && sort.vouched ? "present" : "refused", spare };

  if (!groups.ok) return { ...groups, read: "tokens" };

  const wanted = sort.policies(sort.place, groups.value);
  if (!wanted.ok) return { ...noGroup(wanted.missing), read: "tokens" };

  // A key with no place to act on, as an upload key on a Worker that is bound to no bucket, carries nothing the install uses.
  const whole = wanted.policies.length > 0 && judged.every((token) => carriesRights(sort.place, wanted.policies, token.policies ?? []));

  return { ok: true, value: whole ? "present" : "lacking", spare };
}

/**
 * Read which bucket the install's Worker is bound to.
 *
 * @param connection - a person's token, which reads the Worker's bindings
 * @returns the bucket, `undefined` for a Worker bound to none, or the call Cloudflare refused or did not answer
 */
export async function readBucket(connection: Connection, worker: OwnWorker): Promise<CloudflareResult<Bucket | undefined>> {
  const settings = await readBindings(connection, worker);

  return settings.ok ? { ok: true, value: bucketOf(settings.value) } : settings;
}

/**
 * Read how the install's keys stand.
 *
 * @param held - the keys as the Worker holds them; absent where the reader is not the install's Worker
 * @param connection - a person's token: it reads the account's tokens for the rights of the keys that stand, once for both, and the Worker's bindings where `held` is absent or names an upload key
 * @returns each key's state, and every token of its name the Worker does not hold; or, for a key read with the person's token, the call Cloudflare refused or did not answer. Nothing is changed
 */
export async function readKeyStates(held: HeldKeys | undefined, connection: Connection, worker: OwnWorker): Promise<KeyStates> {
  const stands = held === undefined ? await boundStates(connection, worker) : await heldStates(held, connection, worker);
  const unlisted = (stood: Stands): KeyRead => (stood.ok ? { ok: true, value: stood.value, spare: [] } : stood);
  const idOf = (kind: (typeof KINDS)[number]): string | undefined => {
    const stood = stands[kind];

    return stood.ok ? stood.id : undefined;
  };
  const present = (stood: Stands): boolean => stood.ok && stood.value === "present";
  const standing = KINDS.filter((kind) => present(stands[kind]));
  const { bucket } = stands;
  if (standing.length === 0) return { kept: unlisted(stands.kept), upload: unlisted(stands.upload), bucket };

  const tokens = await callCloudflare(connection, (api) => Array.fromAsync(new BaseTokens(api).list({ account_id: worker.accountId, include_expired: true })));
  const listed: readonly ListedToken[] = tokens.ok ? tokens.value : [];
  const sorts: Readonly<Record<(typeof KINDS)[number], Sort>> = {
    kept: { name: INSTALL_OBJECTS.keyName, policies: keyPolicies, place: worker, vouched: true },
    upload: { name: INSTALL_OBJECTS.uploadKeyName, policies: uploadKeyPolicies, place: { accountId: worker.accountId, bucket }, vouched: false },
  };
  // The groups are listed only for a key that has a token to compare.
  const compared = standing.some((kind) => judgedTokens(sorts[kind], listed, idOf(kind)).length > 0);
  const groups = compared ? await callCloudflare(connection, (api) => Array.fromAsync(new BasePermissionGroups(api).list({ account_id: worker.accountId }))) : ({ ok: true, value: [] } as const);
  const read = (kind: (typeof KINDS)[number]): KeyRead => {
    if (!standing.includes(kind)) return unlisted(stands[kind]);

    return tokens.ok ? listedState(sorts[kind], listed, groups, idOf(kind)) : { ...tokens, read: "tokens" };
  };

  return { kept: read("kept"), upload: read("upload"), bucket };
}
