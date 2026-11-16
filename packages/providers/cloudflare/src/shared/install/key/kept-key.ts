// The key poplin keeps for the Cloudflare API: read from the Worker's secret, and the four plain answers of a call made with it.
//
//   no key                                      no_key
//   401, or 403 whose error code is not 10000   key_refused
//   403 with error code 10000                   lacks_right, with the right the call needs
//   429, 5xx, no answer, an answer cut short    unreachable
//   any other refusal                           unreachable: Cloudflare said nothing of the key
//
// Nothing here logs, and no answer carries the key or a text Cloudflare sent.

import type { Keyed, KeyRefusal } from "@poplin/app/src/console/key/records";
import type { CloudflareFailure, CloudflareResult, Connection } from "../client";

/** The error code of a 403 for a call outside the rights the key was made with. */
const NO_RIGHT_CODE = 10_000;

/** The status of a key Cloudflare does not know, or knows as ended. */
const UNAUTHORIZED = 401;

/** The status of a call the key may not make. */
const FORBIDDEN = 403;

/** A key's whole text: visible ASCII with no space. A line break in it would end every request with an exception. */
const KEY_TEXT = /^[\x21-\x7e]+$/;

/** The key poplin keeps, ready to call Cloudflare with. */
export interface KeptKey {
  readonly connection: Connection;
}

function refusalOf(failure: CloudflareFailure): KeyRefusal {
  if (failure.failure !== "refused") return "unreachable";

  if (failure.status === UNAUTHORIZED) return "key_refused";

  if (failure.status !== FORBIDDEN) return "unreachable";

  return failure.errors.some((error) => error.code === NO_RIGHT_CODE) ? "lacks_right" : "key_refused";
}

/**
 * Read the Worker's secret as the kept key.
 *
 * @param raw - the secret as the Worker was handed it, unchecked
 * @param outside - where the key's calls go; both absent outside tests
 * @returns the key, or `undefined` for a secret that is absent, empty, no text, or text with anything but visible ASCII in it
 */
export function readKeptKey(raw: unknown, outside: { readonly baseUrl?: string | undefined; readonly fetch?: Connection["fetch"] }): KeptKey | undefined {
  if (typeof raw !== "string" || !KEY_TEXT.test(raw)) return undefined;

  return { connection: { key: raw, baseUrl: outside.baseUrl, fetch: outside.fetch } };
}

/**
 * Make one call to Cloudflare with the kept key, and answer it in the four refusals every screen knows.
 *
 * @param right - Cloudflare's name of the right the call needs, carried on `lacks_right`
 * @param call - makes the call on the key's connection; never run without a key
 * @returns the call's value, or the refusal by the table at the top of this file; it throws for nothing the call does
 */
export async function keyed<Value>(key: KeptKey | undefined, right: string, call: (connection: Connection) => Promise<CloudflareResult<Value>>): Promise<Keyed<Value>> {
  if (key === undefined) return { ok: false, refusal: "no_key" };

  try {
    const result = await call(key.connection);
    if (result.ok) return { ok: true, value: result.value };

    const refusal = refusalOf(result);

    return refusal === "lacks_right" ? { ok: false, refusal, right } : { ok: false, refusal };
  } catch {
    // An answer that ends before its body does is thrown by the SDK as it came, and its text is not this file's to pass on.
    return { ok: false, refusal: "unreachable" };
  }
}
