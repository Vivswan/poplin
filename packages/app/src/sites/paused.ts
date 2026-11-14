// The answer to a visitor while the database gives no more reading for the day: no site can be looked up until the next midnight UTC.

import { secondsToNextDay } from "@poplin/core/src/database/driver";

const UNAVAILABLE = 503;

/**
 * Build the page of a site that is paused for the rest of the day.
 *
 * @param now - the clock, in milliseconds since the epoch
 * @returns status 503 with `Retry-After` up to the next midnight UTC. The body is the same for every address and may be cached for a minute, so a flood of visitors costs one answer a minute
 */
export function pausedResponse(now: number): Response {
  return new Response("This site is paused until midnight UTC.\n", {
    status: UNAVAILABLE,
    headers: { "Retry-After": String(secondsToNextDay(now)), "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=60", "X-Robots-Tag": "noindex" },
  });
}
