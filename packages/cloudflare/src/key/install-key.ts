// The kept key as the dashboard sees it: whether the install holds one, whether Cloudflare still takes it, and the way to a new one. The key stays inside this object, and no method answers it.

import type { InstallKey } from "@poplin/app/src/console/key/records";
import { BaseTokens } from "cloudflare/resources/accounts/tokens/tokens";
import { callCloudflare } from "../zone/client";
import type { HeldKey } from "../zone/key/key-state";
import { type KeptKey, keyed } from "./kept-key";

/** The right `verify` is asked under: Cloudflare asks none of a token that verifies itself. */
const NO_RIGHT = "";

/**
 * Make the install's key over the secret the Worker read.
 *
 * @param key - the kept key, or `undefined` on an install that holds none
 * @param accountId - the account that owns the key
 * @param give - makes a new key with a token a person pasted and writes it onto the Worker
 * @returns the install's key, whose `verify` also answers the id of its token. A key Cloudflare knows as disabled or expired, and one refused for a right, verifies as `key_refused`.
 * A new key is read by the Worker's next instance, so this one goes on saying what it held
 */
export function createInstallKey(key: KeptKey | undefined, accountId: string, give: InstallKey["give"]): InstallKey & HeldKey {
  return {
    give,

    has: () => key !== undefined,

    async verify() {
      const verified = await keyed(key, NO_RIGHT, (connection) => callCloudflare(connection, (api) => new BaseTokens(api).verify({ account_id: accountId })));
      if (!verified.ok) return { ok: false, refusal: verified.refusal === "lacks_right" ? "key_refused" : verified.refusal };

      if (verified.value.status !== "active") return { ok: false, refusal: "key_refused" };

      const since = Date.parse(verified.value.not_before ?? "");

      return { ok: true, value: { since: Number.isNaN(since) ? null : since, id: verified.value.id } };
    },
  };
}
