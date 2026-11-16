// How the key of an install stands, read before a check says so or a repair makes a new one.
//
//   on the Worker, which holds the key      the key itself is asked: Cloudflare takes it, or refuses it
//   anywhere else, with a person's token    the Worker has the secret, and Cloudflare lists an active token of the key's name
//
// The second reading cannot tell a key whose value was rolled at Cloudflare from the one the Worker holds. The first can, so the Worker's own word is taken wherever there is one.

import type { InstallKey } from "@poplin/app/src/console/key/records";
import { BaseTokens } from "cloudflare/resources/accounts/tokens/tokens";
import { BaseScriptAndVersionSettings } from "cloudflare/resources/workers/scripts/script-and-version-settings";
import { type CloudflareFailure, type Connection, callCloudflare } from "../client";
import { INSTALL_OBJECTS } from "../install-objects";

/** What the Worker's own key is said to have failed with when Cloudflare gave no usable answer about it. */
const NO_ANSWER: Unread = { ok: false, failure: "network", message: "no answer about the key", read: "tokens" };

/** How a key stands: the install has one that works, has none, or has one Cloudflare takes no more. */
type KeyState = "present" | "missing" | "refused";

/** A reading that failed, with which of the two it was: the Worker's bindings or the account's tokens. */
type Unread = CloudflareFailure & { readonly read: "bindings" | "tokens" };

/** What a reading answers. */
type KeyRead = { readonly ok: true; readonly value: KeyState } | Unread;

/** The Worker whose key is read. */
interface OwnWorker {
  readonly accountId: string;
  readonly script: string;
}

/** The key's state as the Worker that holds it knows it. */
async function heldState(held: Pick<InstallKey, "has" | "verify">): Promise<KeyRead> {
  if (!held.has()) return { ok: true, value: "missing" };

  const verified = await held.verify();
  if (verified.ok) return { ok: true, value: "present" };

  if (verified.refusal === "no_key") return { ok: true, value: "missing" };

  return verified.refusal === "key_refused" ? { ok: true, value: "refused" } : NO_ANSWER;
}

/**
 * Read how the install's key stands.
 *
 * @param held - the key as the Worker holds it; absent where the reader is not the install's Worker
 * @param connection - a person's token, used only where `held` is absent: it reads the Worker's bindings and the account's tokens
 * @returns the state; or, with a person's token, the call Cloudflare refused or did not answer. Nothing is changed
 */
export async function readKeyState(held: Pick<InstallKey, "has" | "verify"> | undefined, connection: Connection, worker: OwnWorker): Promise<KeyRead> {
  if (held !== undefined) return heldState(held);

  const settings = await callCloudflare(connection, (api) => new BaseScriptAndVersionSettings(api).get(worker.script, { account_id: worker.accountId }));
  if (!settings.ok) return { ...settings, read: "bindings" };

  const bound = (settings.value.bindings ?? []).some((binding) => binding.name === INSTALL_OBJECTS.keyBinding && binding.type === "secret_text");
  if (!bound) return { ok: true, value: "missing" };

  const tokens = await callCloudflare(connection, (api) => Array.fromAsync(new BaseTokens(api).list({ account_id: worker.accountId })));
  if (!tokens.ok) return { ...tokens, read: "tokens" };

  return { ok: true, value: tokens.value.some((token) => token.name === INSTALL_OBJECTS.keyName && token.status === "active") ? "present" : "refused" };
}
