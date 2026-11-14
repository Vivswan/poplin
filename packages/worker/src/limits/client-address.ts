// Where Cloudflare puts the address of whoever sent a request.

/** The header Cloudflare writes the client's address into, itself, on every request it hands a Worker: a visitor cannot set it. */
const ADDRESS_HEADER = "CF-Connecting-IP";

/**
 * Read the client address of a request.
 *
 * @returns the address as Cloudflare saw it, IPv4 or IPv6; `undefined` on a request Cloudflare did not hand over, such as one made in a test
 */
export function clientAddress(headers: Headers): string | undefined {
  return headers.get(ADDRESS_HEADER) ?? undefined;
}
