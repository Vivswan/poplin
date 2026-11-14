// The preview answers on one local origin, and the app expects each piece at the root of a hostname. A mount stands between the two.
//
//   the browser asks   http://127.0.0.1:4400/settings
//   the app is asked   https://admin.example.com/settings
//   the app answers    href="/activity"    Location: https://<a site's host label>.example.com/
//   the browser gets   href="/activity"    Location: /served/<a site's host label>/
//
// A site's place is its whole first host label, so the mount knows nothing of how a label is built.
//
// Only addresses are rewritten: in an HTML page, in the `Location` header, and the install's own origins in a JSON answer.
// Every HTML page also gets the preview's bar before its `</body>`, and a refusal in plain text is shown inside a page of the preview that says so.

import { ADDRESSES, DOMAIN } from "./world";

/** The origin the dashboard, the login, and the API are asked at. */
export const ADMIN_ORIGIN = new URL(ADDRESSES.loginFor(new URL(`https://${DOMAIN}/`))).origin;

/** The hostname of that origin, as a page writes it without a scheme. */
const ADMIN_HOSTNAME = new URL(ADMIN_ORIGIN).hostname;

/** Where every site is served, each under its label or its public name. */
export const SERVED_PREFIX = "/served";

/** The end of every hostname of the install. */
const DOMAIN_ENDING = `.${DOMAIN}`;

/** The attributes of the app's pages that hold an address. */
const ADDRESS_ATTRIBUTE = /\b(href|action|formaction)="([^"]*)"/g;

/** A hostname one label under the install's domain, with the scheme before it and the slash after it when a text writes them. */
const HOST_ADDRESS = new RegExp(`(https://)?(?<![%\\w.-])([a-z0-9-]+)${DOMAIN_ENDING.replaceAll(".", "\\.")}/?`, "g");

/** The query keys that speak to the preview and never reach the app, each with the request header that carries its value on. */
const PREVIEW_KEYS = { as: "Preview-As", "preview-visitor": "Preview-Visitor", "preview-login": "Preview-Login" } as const;

/** The query key of a login address that names where to go back to. */
const RETURN_KEY = "return";

/** A dark-scheme media query of a stylesheet. */
const DARK_QUERY = /@media\s*\(prefers-color-scheme:\s*dark\)/g;

/** The declaration that lets a page follow the system's scheme. */
const BOTH_SCHEMES = /color-scheme:\s*light dark/g;

/** The nonce a page's policy allows its one style element under. */
const STYLE_NONCE = /<style nonce="([^"]*)"/;

/** Where the bar's markup names the nonce of its own style element. */
export const NONCE_SLOT = "%nonce%";

/** The headers a rewritten body no longer matches. */
const BODY_HEADERS = ["Content-Length", "ETag", "Accept-Ranges"];

/** One piece of the app at a place of the preview: `prefix` in the browser stands for `base` at `origin`. */
export interface Mount {
  /** The first part of every path of the piece in the preview, such as `/empty`; empty for the piece at the root. */
  readonly prefix: string;

  /** The origin the piece is asked at. */
  readonly origin: string;

  /** The path of the piece at its origin that the prefix stands for: empty for the root. */
  readonly base: string;

  /** What the piece answers with: pages whose addresses are the app's, pages of a site that link relatively, or JSON. */
  readonly holds: "pages" | "site" | "json";

  /** The piece itself. */
  readonly answer: (request: Request) => Promise<Response>;
}

/** A body the mount rewrites: a page, a stylesheet, JSON, or a refusal in plain text. */
type Kind = "html" | "css" | "json" | "plain";

/** How a preview request asks its pages to look. */
interface Look {
  /** The scheme every page is forced to; the system's own when absent. */
  readonly theme: "light" | "dark" | undefined;

  /** The origin the browser asked. */
  readonly origin: string;

  /** The bar's markup, with `NONCE_SLOT` where its style element's nonce goes. */
  readonly bar: string;

  /** Draws a page of the preview around a refusal the app answers as plain text, so the bar leads back from it. */
  readonly framed: (text: string, status: number) => string;
}

function mountedPath(mount: Pick<Mount, "prefix" | "base">, path: string): string {
  return `${mount.prefix}${path.startsWith(mount.base) ? path.slice(mount.base.length) : path}`;
}

/** The preview path of a site's hostname. */
function servedPath(hostname: string): string {
  return `${SERVED_PREFIX}/${hostname.slice(0, -DOMAIN_ENDING.length)}`;
}

/**
 * Write the origin a site is asked at from the part of a preview path that names it.
 *
 * @param label - what follows `/served/` in the path: the site's first host label
 */
export function siteOrigin(label: string): string {
  return `https://${label}${DOMAIN_ENDING}`;
}

/**
 * Write the address in the preview of one the app wrote.
 *
 * @param here - the mount whose page holds the address, which a path without a host belongs to
 * @returns a path of the preview; an address of neither the install nor the mount stays as it is
 */
export function localAddress(address: string, here: Pick<Mount, "prefix" | "origin" | "base">): string {
  if (address.startsWith("/") && !address.startsWith("//")) return mountedPath(here, address);

  const url = URL.parse(address);
  if (url === null) return address;

  // The place a login goes back to is an address of the install too.
  const back = url.searchParams.get(RETURN_KEY);
  if (back !== null) url.searchParams.set(RETURN_KEY, localAddress(back, here));

  const rest = `${url.search}${url.hash}`;
  if (url.origin === here.origin) return `${mountedPath(here, url.pathname)}${rest}`;

  if (url.origin === ADMIN_ORIGIN) return `${url.pathname}${rest}`;

  if (!ADDRESSES.isSiteHost(url.hostname)) return address;

  return `${servedPath(url.hostname)}${url.pathname}${rest}`;
}

/**
 * Make a stylesheet, or a page that holds one, show one scheme whatever the system says.
 *
 * @returns the text with its scheme declaration and its dark-scheme media queries decided
 */
export function forceTheme(text: string, theme: "light" | "dark"): string {
  return text.replace(BOTH_SCHEMES, `color-scheme: ${theme}`).replace(DARK_QUERY, theme === "dark" ? "@media all" : "@media not all");
}

/** Every address of the install a text holds outside an attribute, written as the preview's own: what a person reads and copies is what works here. */
function localText(text: string, origin: string): string {
  const host = origin.replace(/^https?:\/\//, "");
  const written = text.replace(HOST_ADDRESS, (...[whole = "", scheme, label = ""]: string[]) => {
    if (!ADDRESSES.isSiteHost(`${label}${DOMAIN_ENDING}`)) return whole;

    return `${scheme === undefined ? host : origin}${SERVED_PREFIX}/${label}/`;
  });

  return written.replaceAll(ADMIN_ORIGIN, origin).replaceAll(ADMIN_HOSTNAME, host);
}

function withBar(page: string, bar: string): string {
  const [, nonce = ""] = STYLE_NONCE.exec(page) ?? [];
  const end = page.lastIndexOf("</body>");
  if (end === -1) return page;

  return `${page.slice(0, end)}${bar.replaceAll(NONCE_SLOT, nonce)}${page.slice(end)}`;
}

function rewriteBody(text: string, kind: Kind, here: Mount, look: Look, status: number): string {
  if (kind === "json") return localText(text, look.origin);

  if (kind === "plain") return look.framed(text, status);

  const themed = look.theme === undefined ? text : forceTheme(text, look.theme);
  if (kind === "css") return themed;

  if (here.holds === "site") return withBar(themed, look.bar);

  const linked = themed.replace(ADDRESS_ATTRIBUTE, (...[, name, address]: string[]) => `${name}="${localAddress(address ?? "", here)}"`);

  return withBar(localText(linked, look.origin), look.bar);
}

/** Which kind of text a response holds that this mount rewrites; none for a body that goes out as it is. */
function rewrittenKind(response: Response, here: Mount, look: Look): Kind | undefined {
  const type = response.headers.get("Content-Type") ?? "";
  if (response.body === null || response.status === 206) return undefined;

  if (type.startsWith("application/json")) return here.holds === "json" ? "json" : undefined;

  if (here.holds === "json") return undefined;

  if (type.startsWith("text/html")) return "html";

  if (type.startsWith("text/plain") && response.status >= 400) return "plain";

  return type.startsWith("text/css") && look.theme !== undefined ? "css" : undefined;
}

/** The request as the piece expects it: at its own origin, with its own origin as the sender, and the preview's keys moved into headers. */
async function appRequest(request: Request, here: Mount): Promise<Request> {
  const asked = new URL(request.url);
  const url = new URL(`${here.origin}${here.base}${asked.pathname.slice(here.prefix.length)}${asked.search}`);
  const headers = new Headers(request.headers);
  headers.delete("Host");
  if (headers.get("Origin") === asked.origin) headers.set("Origin", here.origin);

  for (const [key, header] of Object.entries(PREVIEW_KEYS)) {
    const value = url.searchParams.get(key);
    url.searchParams.delete(key);
    headers.delete(header);
    if (value !== null) headers.set(header, value);
  }

  // The body is read whole first: a host may hand a request whose stream a second request cannot carry on.
  const body = request.method === "GET" || request.method === "HEAD" ? undefined : await request.arrayBuffer();

  return new Request(url, { method: request.method, headers, body });
}

/**
 * Read what a preview key of the request's address said, after `askMount` moved it into a header.
 *
 * @returns the value, or `undefined` for a request whose address did not hold the key
 */
export function previewValue(headers: { readonly get: (name: string) => string | null }, key: keyof typeof PREVIEW_KEYS): string | undefined {
  return headers.get(PREVIEW_KEYS[key]) ?? undefined;
}

/**
 * Ask one mounted piece a preview request and answer the browser in the preview's own addresses.
 *
 * @param request - a request whose path starts with the mount's prefix
 * @returns the piece's response with its addresses rewritten and the bar on its pages; a body that is no page, stylesheet, or JSON goes out as the piece's own stream
 */
export async function askMount(request: Request, here: Mount, look: Look): Promise<Response> {
  const response = await here.answer(await appRequest(request, here));
  const headers = new Headers(response.headers);
  const location = headers.get("Location");
  if (location !== null) headers.set("Location", localAddress(location, here));

  // The session cookie is made for the install's own domain, which no local origin is.
  headers.delete("Set-Cookie");

  const kind = rewrittenKind(response, here, look);
  if (kind === undefined) return new Response(response.body, { status: response.status, headers });

  for (const name of BODY_HEADERS) headers.delete(name);
  if (kind !== "json") headers.set("Cache-Control", "no-store");

  if (kind === "plain") headers.set("Content-Type", "text/html; charset=utf-8");

  return new Response(rewriteBody(await response.text(), kind, here, look, response.status), { status: response.status, headers });
}
