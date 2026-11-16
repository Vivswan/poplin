// What the checks share: an id no site has, the site a command answered, an address under a site's own, and the one way a refusal is checked.

import { expect } from "bun:test";

import type { LiveAddresses } from "./addresses";
import type { LiveSite, Ran } from "./records";

/** An id no site has: a check asks for it to see what the install answers for a site that is not there. */
export const GHOST_ID = "0live0check0";

/** A problem's code as the product writes one: lowercase words joined by underscores, which hold no name and no address. */
const PROBLEM_CODE = /^[a-z][a-z0-9_]*$/;

/** The statuses the install itself refuses a stranger with; each such answer is never cached. */
const OWN_REFUSALS: ReadonlySet<number> = new Set([302, 303, 401, 403, 404, 405, 429]);

/**
 * Write the address of something inside a site, from the site's own address as the install answered it.
 *
 * @param address - a site's address, with or without its last slash: the install answers either, by its layout
 * @param inside - a path with no slash at its start, with a query where the check wants one
 */
export function under(address: string, inside: string): string {
  return address.endsWith("/") ? `${address}${inside}` : `${address}/${inside}`;
}

/**
 * Say what a command or a tool call that failed met, in a code and a number alone: a problem's other words may quote an address.
 *
 * @param problem - what was answered as the problem, of any shape
 * @param refused - the status of the last answer to the call that was 400 or more
 */
export function failureOf(problem: unknown, refused: number | undefined): string {
  const code: unknown = typeof problem === "object" && problem !== null && "code" in problem ? problem.code : undefined;
  const named = typeof code === "string" && PROBLEM_CODE.test(code) ? `problem ${code}` : "a problem with no code";

  return refused === undefined ? `${named}, and no answer of status 400 or more` : `${named}, last status of 400 or more: ${refused}`;
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
export async function expectRefused(addresses: LiveAddresses, response: Response, text: string): Promise<void> {
  const body = await response.text();
  // A server's failure is no refusal: it hides what the install would have answered.
  expect(response.status).toBeGreaterThanOrEqual(300);
  expect(response.status).toBeLessThan(500);
  expect(body).not.toContain(text);

  // A redirect that leaves the install is the login provider's own answer, whose headers are not the install's.
  const location = response.headers.get("Location");
  const ownAnswer = OWN_REFUSALS.has(response.status) && (location === null || !URL.canParse(location) || addresses.isOwn(location));
  if (ownAnswer) expect(response.headers.get("Cache-Control")).toBe("no-store");
}
