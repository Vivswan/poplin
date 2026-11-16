// The demo under a path of its origin, such as `/poplin/demo`, where a host cannot give it the root.
//
//   the browser asks   /poplin/demo/settings        the demo is asked   /settings
//   the demo answers   href="/activity"             the browser gets    href="/poplin/demo/activity"
//
// Everything inside the demo writes paths from the root. This is the one place that knows the base: it is taken off on the way in and put on on the way out.

import { withTicketAddresses } from "../../../core/src/storage/tickets";
import { withAddresses } from "./addresses";

/** An origin that stands for the demo's own wherever only a path is at hand; no answer ever names it. */
const ANY_ORIGIN = "https://demo.invalid";

/** The headers a rewritten body no longer matches. */
const BODY_HEADERS = ["Content-Length", "ETag"];

/**
 * Decide where an address a visitor's own address names may lead: only to a place under a folder of the demo's origin.
 *
 * The address is read as a browser reads it, so whatever a browser would follow elsewhere is refused, in every spelling of it.
 *
 * @param asked - what the visitor's address names, such as `/activity?kind=sites`; any text at all
 * @param under - the folder it is read against and must stay in: a path with its closing slash, such as `/poplin/demo/`
 * @returns the path, query, and fragment to redirect to, which a browser reads back as the very address that was checked; `undefined` for an address that leads out of the folder or off the origin
 */
export function insidePath(asked: string, under: string): string | undefined {
  const home = new URL(under, ANY_ORIGIN);
  const target = URL.parse(asked, home);
  if (target === null || target.origin !== home.origin || !target.pathname.startsWith(home.pathname)) return undefined;

  // A path alone can still name another host to a browser, as one that begins with two slashes does.
  const written = `${target.pathname}${target.search}${target.hash}`;
  if (URL.parse(written, home)?.href !== target.href) return undefined;

  return written;
}

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

/** Whether an address is a path from the root of its origin, and not the two slashes that name another host. */
function isRootPath(address: string): boolean {
  return address.startsWith("/") && !address.startsWith("//");
}

/**
 * Put the base on the path each ticket of a JSON answer names. A ticket of the install's own route says where a file goes as a path from the install's root, which is the base here.
 *
 * @param text - the body of a JSON answer
 * @returns the body with the base on every ticket's path; a body that hands out no tickets, or is no JSON, as it was
 */
function withTicketPaths(text: string, base: string): string {
  let answer: unknown;

  try {
    answer = JSON.parse(text);
  } catch {
    // A file of a served site may be called JSON and be none: it goes out as it is.
    return text;
  }

  const based = withTicketAddresses(answer, (address) => (isRootPath(address) ? `${base}${address}` : address));

  return based === undefined ? text : JSON.stringify(based);
}

/**
 * Put the base on every address of the demo an answer holds.
 *
 * @param origin - the origin the browser asked, which a page or a JSON answer writes whole addresses with
 * @returns the answer with the base on its `Location`, on the paths in its page's attributes, on its own origin's addresses in a page's text or in JSON, and on the path of every ticket a JSON answer hands out; any other body goes out as it is
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
  const based = isPage ? withAddresses(text, (address) => (isRootPath(address) ? `${base}${address}` : address)) : withTicketPaths(text, base);

  return new Response(based, { status: response.status, headers });
}
