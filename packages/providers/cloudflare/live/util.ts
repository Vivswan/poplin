// What the checks share: an id no site has, the site a command answered, an address under a site's own, and the one way a refusal is checked.

import { expect } from "bun:test";

import type { LiveAddresses } from "./addresses";
import type { LiveSite, Met, Ran } from "./records";

/** An id no site has: a check asks for it to see what the install answers for a site that is not there. */
export const GHOST_ID = "0live0check0";

/** A problem's code as the product writes one: lowercase words joined by underscores, which hold no name and no address. */
const PROBLEM_CODE = /^[a-z][a-z0-9_]*$/;

/** The code or the name a runtime gives a request's failure: one word, which holds no host. */
const FAILURE_CODE = /^[A-Za-z][A-Za-z0-9_]*$/;

/** What a failure with no such word is called. */
const NO_CODE = "no code";

/** How many causes deep a failure's code is looked for: a failure may name itself as its cause. */
const CAUSES = 4;

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

/** A value that is one such word, or `undefined`. */
function oneWord(value: unknown): string | undefined {
  return typeof value === "string" && FAILURE_CODE.test(value) ? value : undefined;
}

/**
 * Name the failure of a request that got no answer by its code, the code of what caused it, or its name. Its words are never read: a runtime puts the host into them.
 *
 * @param causes - how many causes deep a code is still looked for
 * @returns the code or the name where it is one word of letters, digits and underscores, and `no code` for anything else
 */
export function thrownCode(error: unknown, causes = CAUSES): string {
  if (typeof error !== "object" || error === null) return NO_CODE;

  // Each is read once, so the word that was checked is the word that is told.
  const code = oneWord("code" in error ? error.code : undefined);
  if (code !== undefined) return code;

  const cause: unknown = "cause" in error ? error.cause : undefined;
  if (cause !== undefined && causes > 0) return thrownCode(cause, causes - 1);

  return oneWord("name" in error ? error.name : undefined) ?? NO_CODE;
}

/**
 * Say what a command or a tool call that failed met, in codes and a number alone: a problem's other words may quote an address.
 *
 * @param problem - what was answered as the problem, of any shape
 */
export function failureOf(problem: unknown, met: Met): string {
  const code: unknown = typeof problem === "object" && problem !== null && "code" in problem ? problem.code : undefined;
  const named = typeof code === "string" && PROBLEM_CODE.test(code) ? `problem ${code}` : "a problem with no code";
  const refused = met.refused === undefined ? "no answer of status 400 or more" : `last status of 400 or more: ${met.refused}`;
  const unanswered = met.unanswered.length === 0 ? "" : `, requests with no answer: ${met.unanswered.join(", ")}`;

  return `${named}, ${refused}${unanswered}`;
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
