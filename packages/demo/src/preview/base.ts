// The demo under a path of its origin, such as `/poplin/demo`, where a host cannot give it the root.
//
//   the browser asks   /poplin/demo/settings        the demo is asked   /settings
//   the demo answers   href="/activity"             the browser gets    href="/poplin/demo/activity"
//
// Everything inside the demo writes paths from the root. This is the one place that knows the base: it is taken off on the way in and put on on the way out.

/** An attribute of a page that holds a path from the root; the path's own first slash follows. */
const ROOT_PATH_ATTRIBUTE = /\b(href|action|formaction|src)="\/(?!\/)/g;

/** The headers a rewritten body no longer matches. */
const BODY_HEADERS = ["Content-Length", "ETag"];

/**
 * Take the base off a request's path.
 *
 * @param base - the path the demo sits under, with no closing slash
 * @returns the request as the demo expects it, its body read whole; `undefined` for a path outside the base
 */
export async function unbased(request: Request, base: string): Promise<Request | undefined> {
  const url = new URL(request.url);
  if (url.pathname !== base && !url.pathname.startsWith(`${base}/`)) return undefined;

  url.pathname = url.pathname.slice(base.length) || "/";
  const body = request.method === "GET" || request.method === "HEAD" ? undefined : await request.arrayBuffer();

  return new Request(url, { method: request.method, headers: request.headers, body });
}

/**
 * Put the base on every address of the demo an answer holds.
 *
 * @param origin - the origin the browser asked, which a page or a JSON answer writes whole addresses with
 * @returns the answer with the base on its `Location`, on the paths in its page's attributes, and on its own origin's addresses in a page's text or in JSON; any other body goes out as it is
 */
export async function rebased(response: Response, base: string, origin: string): Promise<Response> {
  const headers = new Headers(response.headers);
  const location = headers.get("Location");
  if (location?.startsWith("/") === true) headers.set("Location", `${base}${location}`);

  const type = headers.get("Content-Type") ?? "";
  const isPage = type.startsWith("text/html");
  if (response.body === null || !(isPage || type.startsWith("application/json"))) return new Response(response.body, { status: response.status, headers });

  for (const name of BODY_HEADERS) headers.delete(name);

  const host = origin.replace(/^https?:\/\//, "");
  const text = (await response.text()).replaceAll(`${host}/`, () => `${host}${base}/`);

  // Functions, so a base that holds a `$` is written as it is.
  const based = isPage ? text.replace(ROOT_PATH_ATTRIBUTE, (...[, name]: string[]) => `${name}="${base}/`) : text;

  return new Response(based, { status: response.status, headers });
}
