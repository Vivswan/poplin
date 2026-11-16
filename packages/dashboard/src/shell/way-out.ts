// Where Log out leads, read from the address the page was handed.

import { httpsLink } from "@/lib/https-link";

/** The schemes an address of the dashboard's own origin is read under. */
const WEB: ReadonlySet<string> = new Set(["https:", "http:"]);

/**
 * Read the address that ends this browser's login: a whole one that starts with https, or a path of the dashboard's own origin.
 *
 * @param origin - the origin the dashboard answers at, which a path is read against and the link begins with
 * @returns the address as a link holds it; `undefined` for anything else, so no text that reached the page is run by a press or leads to another host unasked
 */
export function wayOut(address: string, origin: string): string | undefined {
  const whole = httpsLink(address);
  if (whole !== undefined) return whole;

  if (!URL.canParse(address, origin)) return undefined;

  const own = new URL(address, origin);
  // A blob's address counts as of the origin it was made at, and is no path of it.
  if (own.origin !== origin || !WEB.has(own.protocol)) return undefined;

  return `${origin}${own.pathname}${own.search}${own.hash}`;
}
