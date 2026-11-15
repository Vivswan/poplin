// The one key an install keeps for its provider, as the console sees it: whether there is one, whether it still works, and the four plain answers of a call made with it.

import type { DomainReading } from "../domain/records";

/** Why a call made with the install's key gave no value: the install holds no key, the provider refuses the key, the key lacks one right, or the provider gave no usable answer. */
export type KeyRefusal = "no_key" | "key_refused" | "lacks_right" | "unreachable";

/** What a call made with the install's key answers. `right` is on `lacks_right` alone, and names the missing right in the provider's own words. */
export type Keyed<Value> = { readonly ok: true; readonly value: Value } | { readonly ok: false; readonly refusal: KeyRefusal; readonly right?: string };

/** The install's key, as the console sees it. No method answers the key. */
export interface InstallKey {
  /** Whether the install holds a key. No call to the provider. */
  has(): boolean;

  /** Ask the provider whether the key still works. `since` is when it began to, in milliseconds since the epoch, and `null` when the provider names no such time. */
  verify(): Promise<Keyed<{ readonly since: number | null }>>;

  /** Make a new key with a one-time authorisation, write it, and delete the old one. The only paste after install. */
  give(authorisation: string): Promise<DomainReading>;
}
