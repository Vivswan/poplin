// The answer to a request that a limit refused.

import type { Refusal } from "./limits";

const TOO_MANY_REQUESTS = 429;

/**
 * Build the response to a refused request.
 *
 * @returns status 429 with `Retry-After` in seconds. The body is the same for every limit, so it tells a visitor nothing about other sites or other visitors
 */
export function refusalResponse(refusal: Refusal): Response {
  const seconds = Math.max(1, Math.ceil(refusal.retryAfterSeconds));

  return new Response(`Too many requests. Try again in ${seconds} seconds.\n`, {
    status: TOO_MANY_REQUESTS,
    headers: { "Retry-After": String(seconds), "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}
