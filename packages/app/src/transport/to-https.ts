// The first thing asked of every request: did it come over plain http?
//
//   http://report--k3f9x2ab71qz-p-poplin.example.com/a?b   ->  308, Location: https://report--k3f9x2ab71qz-p-poplin.example.com/a?b
//   https://anything                                       ->  nothing: the program answers it
//   http://127.0.0.1:4400/                                 ->  nothing: a request to this machine itself crosses no network
//
// It reads the request's address and nothing else: no site is looked up, no counter is touched, and no database is asked, so a request over http costs the install nothing and is counted by no limit.
// A provider's own rule may send the same redirect before the program runs. This one holds where that rule is absent.

import { isLoopback } from "@poplin/core/src/api/loopback";

/** The scheme of a request that crossed a network in the clear. */
const PLAIN = "http:";

/** The scheme every answer of the install is given over. */
const SECURE = "https:";

/** The redirect that keeps the method and the body, and that a browser may remember: the same answer for every method, so no request is served or refused by what it asked. */
const MOVED_FOR_GOOD = 308;

/**
 * Send a request that came over plain http to the same address over https.
 *
 * @returns the redirect, with no body and no cookie, for a request over http to any hostname but this machine's own; `undefined` for every other request, which the program then answers
 */
export function toHttps(request: Request): Response | undefined {
  const url = new URL(request.url);
  if (url.protocol !== PLAIN || isLoopback(url.hostname)) return undefined;

  url.protocol = SECURE;

  return new Response(null, { status: MOVED_FOR_GOOD, headers: { Location: url.href } });
}
