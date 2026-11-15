// The site id: twelve random characters that tell apart sites sharing a name. It is the unguessable part of a site's address.

import type { Checked } from "../names/names";
import { randomText } from "../records/random-text";

/** The form of a site id: about 62 bits, so an id cannot be guessed. */
const SITE_ID_PATTERN = /^[0-9a-z]{12}$/;

declare const siteIdBrand: unique symbol;

/** Twelve base36 characters, from `mintSiteId` or `parseSiteId`; no other code can make one. */
export type SiteId = string & { readonly [siteIdBrand]: true };

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
 * @returns twelve base36 characters, each as likely as any other; whether a site already has them is for whoever stores the site to answer
 */
export function mintSiteId(): SiteId {
  return randomText("site-id") as SiteId;
}
