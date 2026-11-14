// Whether a request that changes something was sent by a page of the dashboard itself.

/** What the browser says of a request sent by a page of the same origin. */
const SAME_ORIGIN = "same-origin";

/**
 * Decide whether a request comes from the origin it is sent to.
 *
 * @param request - its `Origin` header must be there and equal the origin of its own address; its `Sec-Fetch-Site` header, where the browser sends one, must say `same-origin`
 * @returns `false` for a request with no `Origin`, with another one, or marked as coming from elsewhere
 */
export function isSameOrigin(request: Pick<Request, "url" | "headers">): boolean {
  const origin = request.headers.get("Origin");
  if (origin === null || origin !== new URL(request.url).origin) return false;

  const fetchSite = request.headers.get("Sec-Fetch-Site");

  return fetchSite === null || fetchSite === SAME_ORIGIN;
}
