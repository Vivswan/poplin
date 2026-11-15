// What the checks share: the forms of a site's address as a stranger types them, the site a command answered, and the one way a refusal is checked.

import { expect } from "bun:test";

import type { LiveSite, Ran } from "./records";

/** The fixed word every label address ends in, before the domain. */
const MARKER = "-poplin";

/** An id no site has: a check asks for it to see what the install answers for a site that is not there. */
export const GHOST_ID = "0live0check0";

/** The statuses the install itself refuses a stranger with; each such answer is never cached. */
const OWN_REFUSALS: ReadonlySet<number> = new Set([302, 303, 401, 403, 404, 405, 429]);

/** The letter of a label address: `p` for a private site, `u` for every other, and none for the form without a letter. */
type Letter = "p" | "u" | undefined;

/**
 * Write a label address by hand, as a stranger would type it.
 *
 * @param label - `<name>--<id>`, or a bare id
 * @returns the address with a trailing slash
 */
export function labelAddress(domain: string, label: string, letter: Letter): string {
  const lettered = letter === undefined ? "" : `-${letter}`;

  return `https://${label}${lettered}${MARKER}.${domain}/`;
}

/** Whether an address is on the install's domain or on a hostname under it. */
export function isOwnAddress(domain: string, address: string): boolean {
  if (!URL.canParse(address)) return false;

  const { hostname } = new URL(address);

  return hostname === domain || hostname.endsWith(`.${domain}`);
}

/** The site a command answered, after a command that must exit 0. */
export function siteOf(ran: Ran): LiveSite {
  expect(ran.code).toBe(0);

  return ran.value.site as LiveSite;
}

/**
 * Fail unless an answer hands a stranger nothing: no success, none of the page's text, and no stored copy.
 *
 * @param text - the page's body, which the answer must not hold
 */
export async function expectRefused(domain: string, response: Response, text: string): Promise<void> {
  const body = await response.text();
  // A server's failure is no refusal: it hides what the install would have answered.
  expect(response.status).toBeGreaterThanOrEqual(300);
  expect(response.status).toBeLessThan(500);
  expect(body).not.toContain(text);

  // A redirect that leaves the domain is the login provider's own answer, whose headers are not the install's.
  const location = response.headers.get("Location");
  const ownAnswer = OWN_REFUSALS.has(response.status) && (location === null || !URL.canParse(location) || isOwnAddress(domain, location));
  if (ownAnswer) expect(response.headers.get("Cache-Control")).toBe("no-store");
}
