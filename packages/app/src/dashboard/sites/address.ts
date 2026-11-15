// How a site's link is shown: without its scheme, and an unlisted site's id left out until its owner asks for it.

import type { getSite } from "@poplin/core/src/actions/show";
import { html } from "hono/html";

import type { Html } from "../records";

/** What stands where an unlisted site's id is: the id is the key to the site, and a screen can be read by anyone near it. */
const MASK = "******";

/** What of a site its shown link is built from. */
type Linked = Pick<Extract<Awaited<ReturnType<typeof getSite>>, { ok: true }>["site"], "url" | "id" | "access">;

function plain(site: Linked): string {
  return site.url.replace(/^https:\/\//, "");
}

/**
 * Whether a site's shown link leaves its id out.
 *
 * @returns `true` for an unlisted site whose link holds its id
 */
export function hidesId(site: Linked): boolean {
  return site.access === "unlisted" && plain(site).includes(site.id);
}

/**
 * Build a site's link as text.
 *
 * @param whole - `true` shows an unlisted site's id too
 * @returns the link without its scheme; the copy button beside it gives the whole link either way
 */
export function shownAddress(site: Linked, whole = false): Html {
  const address = plain(site);
  if (whole || !hidesId(site)) return html`<span class="lk">${address}</span>`;

  const [before = "", after = ""] = address.split(site.id);

  return html`<span class="lk">${before}<span class="mask" title="Hidden here. Copy gives the whole link.">${MASK}</span>${after}</span>`;
}
