// Whether a request that changes something was sent by a page of the dashboard itself.

/** What the browser says of a request sent by a page of the same origin. A page's script cannot set or change this header. */
const SAME_ORIGIN = "same-origin";

/** What a browser sends as `Origin` when the page's referrer policy keeps the page's origin back. */
const WITHHELD = "null";

/**
 * Decide whether a request comes from the origin it is sent to.
 *
 * @param request - either its `Origin` header equals the origin of its own address and no `Sec-Fetch-Site` header says otherwise, or its `Origin` is absent or `null` and its `Sec-Fetch-Site` header says `same-origin`
 * @returns `false` for a request of another origin, of a sibling hostname of the same site, or with neither header naming this origin
 */
export function isSameOrigin(request: Pick<Request, "url" | "headers">): boolean {
  const origin = request.headers.get("Origin");
  const fetchSite = request.headers.get("Sec-Fetch-Site");
  if (origin === null || origin === WITHHELD) return fetchSite === SAME_ORIGIN;

  if (origin !== new URL(request.url).origin) return false;

  return fetchSite === null || fetchSite === SAME_ORIGIN;
}
