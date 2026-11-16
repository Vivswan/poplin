// How the key of an install stands, read before a check says so or a repair makes a new one.
//
//   on the Worker, which holds the key      the key itself is asked: Cloudflare takes it, or refuses it
//   anywhere else, with a person's token    the Worker has the secret, and Cloudflare lists an active token of the key's name
//   a key that stands, either way           its rights are read from the account's tokens, with the person's token: one made before a right was added lacks it
//
// The second reading cannot tell a key whose value was rolled at Cloudflare from the one the Worker holds. The first can, so the Worker's own word is taken wherever there is one.
// A key answers nothing about its own rights, so they are read from the active tokens of the key's name: the key stands when one of them carries every right.

import type { InstallKey } from "@poplin/app/src/console/key/records";
import { BasePermissionGroups } from "cloudflare/resources/accounts/tokens/permission-groups";
import { BaseTokens } from "cloudflare/resources/accounts/tokens/tokens";
import { BaseScriptAndVersionSettings } from "cloudflare/resources/workers/scripts/script-and-version-settings";
import { type CloudflareFailure, type Connection, callCloudflare } from "../client";
import { INSTALL_OBJECTS } from "../install-objects";
import { type KeyPlace, keyPolicies, noGroup } from "./rights";

/** What the Worker's own key is said to have failed with when Cloudflare gave no usable answer about it. */
const NO_ANSWER: Unread = { ok: false, failure: "network", message: "no answer about the key", read: "tokens" };

/** How a key stands: the install has one that works, has none, has one Cloudflare takes no more, or has one that lacks a right the install uses. */
type KeyState = "present" | "missing" | "refused" | "lacking";

/** A reading that failed, with which of the two it was: the Worker's bindings or the account's tokens. A right Cloudflare lists no group for leaves the tokens unread: no key can be compared with it. */
type Unread = (CloudflareFailure | ReturnType<typeof noGroup>) & { readonly read: "bindings" | "tokens" };

/** What a reading answers. */
type KeyRead = { readonly ok: true; readonly value: KeyState } | Unread;

/** The Worker whose key is read, and where the key acts. */
type OwnWorker = KeyPlace & { readonly script: string };

/** The key's state as the Worker that holds it knows it. */
async function heldState(held: Pick<InstallKey, "has" | "verify">): Promise<KeyRead> {
  if (!held.has()) return { ok: true, value: "missing" };

  const verified = await held.verify();
  if (verified.ok) return { ok: true, value: "present" };

  if (verified.refusal === "no_key") return { ok: true, value: "missing" };

  return verified.refusal === "key_refused" ? { ok: true, value: "refused" } : NO_ANSWER;
}

/** Whether the Worker has the key's secret, as a person's token reads its bindings. */
async function boundState(connection: Connection, worker: OwnWorker): Promise<KeyRead> {
  const settings = await callCloudflare(connection, (api) => new BaseScriptAndVersionSettings(api).get(worker.script, { account_id: worker.accountId }));
  if (!settings.ok) return { ...settings, read: "bindings" };

  const bound = (settings.value.bindings ?? []).some((binding) => binding.name === INSTALL_OBJECTS.keyBinding && binding.type === "secret_text");

  return { ok: true, value: bound ? "present" : "missing" };
}

/**
 * Read how a key that stands is listed at Cloudflare: whether an active token of its name carries every right of a key.
 *
 * @param vouched - whether the Worker's own key answered for itself, so that no token of the name being listed leaves it standing
 */
async function listedState(connection: Connection, worker: OwnWorker, vouched: boolean): Promise<KeyRead> {
  const tokens = await callCloudflare(connection, (api) => Array.fromAsync(new BaseTokens(api).list({ account_id: worker.accountId })));
  if (!tokens.ok) return { ...tokens, read: "tokens" };

  const active = tokens.value.filter((token) => token.name === INSTALL_OBJECTS.keyName && token.status === "active");
  if (active.length === 0) return { ok: true, value: vouched ? "present" : "refused" };

  const groups = await callCloudflare(connection, (api) => Array.fromAsync(new BasePermissionGroups(api).list({ account_id: worker.accountId })));
  if (!groups.ok) return { ...groups, read: "tokens" };

  const wanted = keyPolicies(worker, groups.value);
  if (!wanted.ok) return { ...noGroup(wanted.missing), read: "tokens" };

  const needed = wanted.policies.flatMap((policy) => policy.permission_groups.map((group) => group.id));
  const whole = active.some((token) => {
    const carried = new Set((token.policies ?? []).flatMap((policy) => policy.permission_groups.map((group) => group.id)));

    return needed.every((id) => carried.has(id));
  });

  return { ok: true, value: whole ? "present" : "lacking" };
}

/**
 * Read how the install's key stands.
 *
 * @param held - the key as the Worker holds it; absent where the reader is not the install's Worker
 * @param connection - a person's token: it reads the account's tokens for the rights of a key that stands, and the Worker's bindings where `held` is absent
 * @returns the state; or the call Cloudflare refused the person's token or did not answer. Nothing is changed
 */
export async function readKeyState(held: Pick<InstallKey, "has" | "verify"> | undefined, connection: Connection, worker: OwnWorker): Promise<KeyRead> {
  const stands = held === undefined ? await boundState(connection, worker) : await heldState(held);
  if (!stands.ok || stands.value !== "present") return stands;

  return listedState(connection, worker, held !== undefined);
}
