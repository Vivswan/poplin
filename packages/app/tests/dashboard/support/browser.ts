// The request headers a browser puts on a form it submits to the page's own origin, worked out from the page's answer as the Fetch standard does.

/** Every referrer policy a browser knows. */
const POLICIES = ["no-referrer", "no-referrer-when-downgrade", "same-origin", "origin", "strict-origin", "origin-when-cross-origin", "strict-origin-when-cross-origin", "unsafe-url"];

/** The policy of a page that names none. */
const DEFAULT_POLICY = "strict-origin-when-cross-origin";

/** The one policy under which a same-origin form post over HTTPS carries `Origin: null` in place of the page's origin. */
const WITHHOLDING = "no-referrer";

/** Which browser sends the form: one of today, or one from before browsers sent `Sec-Fetch-Site` (Safari before 16.4, Firefox before 90). */
type Browser = "current" | "before-fetch-metadata";

/**
 * Build the headers of a form post from a page to an address of its own origin.
 *
 * @param page - the answer that carried the form; its `Referrer-Policy` decides the `Origin`, the last known policy of a list winning
 * @param origin - the origin the page was served from, over HTTPS
 * @returns `Origin`, `Content-Type`, and from a current browser `Sec-Fetch-Site`; no cookie
 */
export function formHeadersOf(page: Pick<Response, "headers">, origin: string, browser: Browser = "current"): Record<string, string> {
  const named = (page.headers.get("Referrer-Policy") ?? "").split(",").map((policy) => policy.trim().toLowerCase());
  const policy = named.filter((one) => POLICIES.includes(one)).at(-1) ?? DEFAULT_POLICY;
  const headers = { Origin: policy === WITHHOLDING ? "null" : origin, "Content-Type": "application/x-www-form-urlencoded" };

  return browser === "current" ? { ...headers, "Sec-Fetch-Site": "same-origin" } : headers;
}
