// The site id: twelve random characters that tell apart sites sharing a name. It is the unguessable part of a site's address.

import type { Checked } from "../names/names";

/** How many characters a site id holds: about 62 bits, so an id cannot be guessed. */
export const SITE_ID_LENGTH = 12;

/** The form of a site id. */
const SITE_ID_PATTERN = /^[0-9a-z]{12}$/;

/** The symbols an id is drawn from. */
const BASE36 = "0123456789abcdefghijklmnopqrstuvwxyz";

/** The first byte value that is not mapped to a symbol: past the last whole run of the alphabet a byte would favour its first symbols. */
const UNBIASED_BYTE_LIMIT = 256 - (256 % BASE36.length);

declare const siteIdBrand: unique symbol;

/** Twelve base36 characters, from `mintSiteId` or `parseSiteId`; no other code can make one. */
export type SiteId = string & { readonly [siteIdBrand]: true };

/** Fills the given bytes with random values. */
type RandomFill = (bytes: Uint8Array<ArrayBuffer>) => void;

function fillFromCrypto(bytes: Uint8Array<ArrayBuffer>): void {
  crypto.getRandomValues(bytes);
}

/**
 * Decide whether a string has the form of a site id.
 *
 * @returns the id, or `bad-id`. Only the form is checked, and a twelve-character name has the same form: which of the two a string is, only a lookup tells
 */
export function parseSiteId(raw: string): Checked<SiteId> {
  if (!SITE_ID_PATTERN.test(raw)) return { ok: false, refusal: "bad-id" };

  return { ok: true, value: raw as SiteId };
}

/**
 * Mint a site id.
 *
 * @param fill - the random source, which must give independent, evenly spread bytes; Web Crypto unless a test brings its own
 * @returns twelve base36 characters, each as likely as any other; whether a site already has them is for whoever stores the site to answer
 */
export function mintSiteId(fill: RandomFill = fillFromCrypto): SiteId {
  let id = "";

  while (id.length < SITE_ID_LENGTH) {
    const bytes = new Uint8Array(SITE_ID_LENGTH);
    fill(bytes);

    for (const byte of bytes) {
      if (byte >= UNBIASED_BYTE_LIMIT) continue;
      if (id.length === SITE_ID_LENGTH) break;

      id += BASE36[byte % BASE36.length];
    }
  }

  return id as SiteId;
}
