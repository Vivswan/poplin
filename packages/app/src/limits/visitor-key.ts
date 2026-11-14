// The visitor key: what the per-visitor limit counts by. It stands for the visitor's network and holds no address.
//
//   IPv4   the whole address
//   IPv6   the first 64 bits, since one visitor is handed a whole /64 and could change the rest at will
//
// The address comes from the caller, which reads it from wherever its host puts the address the host itself saw, never from a header a visitor can set.
// The key is a keyed hash of the day and the network, so it cannot be turned back into an address, and yesterday's key says nothing about today's.

import { toHex } from "@poplin/core/src/records/hex";
import ipaddr from "ipaddr.js";

/** What stands in for the network when the address is absent or is no address: all such requests share one count. */
const NO_NETWORK = "unknown";

/** How many 16-bit groups of an IPv6 address name the network: the first 64 bits. */
const NETWORK_GROUPS = 4;

/** The base IPv6 groups are written in. */
const HEX = 16;

/** How many bytes of the hash make the key: 128 bits, far more than tells any two networks apart. */
const KEY_BYTES = 16;

declare const visitorKeyBrand: unique symbol;

/** 32 hex characters from `visitorKey`; no other code can make one. */
export type VisitorKey = string & { readonly [visitorKeyBrand]: true };

/** The network an address belongs to, in one spelling per network. An IPv4 address written inside an IPv6 one counts as the IPv4 address. */
function networkOf(text: string): string {
  if (!ipaddr.isValid(text)) return NO_NETWORK;

  const address = ipaddr.process(text);
  if (address instanceof ipaddr.IPv4) return address.toString();

  const groups = address.parts.slice(0, NETWORK_GROUPS).map((group) => group.toString(HEX));

  return `${groups.join(":")}::/64`;
}

/**
 * Derive the key the per-visitor limit counts a request by.
 *
 * @param address - the client address as the host saw it, IPv4 or IPv6; `undefined` when the host gave none
 * @param secret - an HMAC SHA-256 key with the `sign` usage, kept by the install. Replacing it starts every visitor's minute anew and breaks nothing
 * @param now - the time, in milliseconds since the epoch; the key changes at every midnight UTC
 * @returns the same key for every address of one network on one day
 */
export async function visitorKey(address: string | undefined, secret: CryptoKey, now: number): Promise<VisitorKey> {
  const network = networkOf(address?.trim() ?? "");
  const day = new Date(now).toISOString().slice(0, 10);
  const hash = await crypto.subtle.sign("HMAC", secret, new TextEncoder().encode(`${day}\n${network}`));
  const bytes = new Uint8Array(hash, 0, KEY_BYTES);

  return toHex(bytes) as VisitorKey;
}
