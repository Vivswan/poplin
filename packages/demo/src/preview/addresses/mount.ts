// The app expects each piece at the root of a hostname of the install, and a browser on this machine asks a local address. A mount stands between the two.
//
//   the browser asks   http://127.0.0.1:4400/data/sites
//   the app is asked   https://poplin.example.com/data/sites
//   the app answers    "url": "https://<a site's host label>.example.com/"    Location: https://<a site's host label>.example.com/
//   the browser gets   "url": "http://127.0.0.1:4400/served/<a site's host label>/"    Location: /served/<a site's host label>/
//   a site with a real address, where the host has one: "url": "https://<its address on a real install>/"
//
//   the browser asks   http://127.0.0.1:4400/data/sites?q=http://127.0.0.1:4400/served/<a site's host label>/
//   the app is asked   https://poplin.example.com/data/sites?q=https://<a site's host label>.example.com/
//
// Where a site's address is on this machine is the kind's to say: `kind.ts` holds both layouts.
//
// Only addresses are rewritten: in an HTML page, in the `Location` header, and the install's own origins in a JSON answer.
// A refusal in plain text is shown inside a page of the preview that says so.

import { withAddresses } from "./addresses";
import type { Kind } from "../world/kind";

/** Where every site of an install under a domain is served, each under its label or its public name. */
export const SERVED_PREFIX = "/served";

/** The query keys that speak to the preview and never reach the app, each with the request header that carries its value on. */
const PREVIEW_KEYS = { as: "Preview-As", "preview-visitor": "Preview-Visitor" } as const;

/** The query key a screen's search is sent under: a site's address on this machine, pasted there, reaches the app as the install's own. */
const SEARCH_KEY = "q";

/** No site with a real address. */
const NO_REAL: ReadonlyMap<string, string> = new Map();

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

/** A body the mount rewrites: a page, JSON, or a refusal in plain text. */
type Body = "html" | "json" | "plain";

/** How a preview request asks its pages to look. */
interface Look {
  /** The kind of install the piece belongs to, which says where each of its addresses is here. */
  readonly kind: Kind;

  /** The origin the browser asked. */
  readonly origin: string;

  /** Draws a page of the preview around a refusal the app answers as plain text, which leads back to the dashboard. */
  readonly framed: (text: string, status: number) => Promise<string>;

  /** The address a link to a site leads to instead of the preview's own serving of it, by the site's hostname: the root of an https origin, or of the dashboard. None when left out. */
  readonly real?: ReadonlyMap<string, string>;
}

/** Where an address is read from. */
interface From {
  /** The mount whose answer holds the address, which a path without a host belongs to. */
  readonly here: Pick<Mount, "prefix" | "origin" | "base">;

  /** The kind of install, which says where a site's address is here. */
  readonly kind: Kind;

  /** The address a site's own leads to instead, by the site's hostname. None when left out. */
  readonly real?: ReadonlyMap<string, string>;
}

function mountedPath(mount: Pick<Mount, "prefix" | "base">, path: string): string {
  return `${mount.prefix}${path.startsWith(mount.base) ? path.slice(mount.base.length) : path}`;
}

/**
 * Write the address in the preview of one the app wrote.
 *
 * @returns an address of the preview, as a path where it is at the origin the mount answers on, or the real address of a site that has one; an address of neither the install nor the mount stays as it is
 */
export function localAddress(address: string, { here, kind, real = NO_REAL }: From): string {
  if (address.startsWith("/") && !address.startsWith("//")) return mountedPath(here, address);

  const url = URL.parse(address);
  if (url === null) return address;

  const rest = `${url.search}${url.hash}`;
  if (url.origin === here.origin) return `${mountedPath(here, url.pathname)}${rest}`;

  if (url.origin === kind.adminOrigin) return `${url.pathname}${rest}`;

  if (!kind.addresses.isSiteHost(url.hostname)) return address;

  const root = real.get(url.hostname);
  if (root === undefined) return `${kind.siteRoot(url.hostname)}${url.pathname}${rest}`;

  // The dashboard's own root is a path of the preview, as every address of the dashboard is.
  const moved = `${root}${url.pathname.slice(1)}${rest}`;

  return moved.startsWith(`${kind.adminOrigin}/`) ? moved.slice(kind.adminOrigin.length) : moved;
}

async function rewriteBody(text: string, body: Body, here: Mount, look: Look, status: number): Promise<string> {
  const real = look.real ?? NO_REAL;
  if (body === "json") return look.kind.localText(text, look.origin, real);

  // A refusal may name an address of the console itself, as the page of an email that is no user does: it is named where the preview answers it.
  if (body === "plain") return look.framed(text.replaceAll(`${here.origin}${here.base}`, `${look.origin}${here.prefix}`), status);

  const linked = withAddresses(text, (address) => localAddress(address, { here, kind: look.kind, real }));

  return look.kind.localText(linked, look.origin, real);
}

/** Which kind of text a response holds that this mount rewrites; none for a body that goes out as it is. */
function rewrittenBody(response: Response, here: Mount): Body | undefined {
  const type = response.headers.get("Content-Type") ?? "";
  if (response.body === null || response.status === 206) return undefined;

  // The console answers JSON beside its pages, and the addresses in it are the install's own too.
  if (type.startsWith("application/json")) return here.holds === "site" ? undefined : "json";

  if (here.holds === "json") return undefined;

  // A site's own page links relatively, so it goes out as it is.
  if (type.startsWith("text/html")) return here.holds === "site" ? undefined : "html";

  return type.startsWith("text/plain") && response.status >= 400 ? "plain" : undefined;
}

/** The request as the piece expects it: at its own origin, with its own origin as the sender, the preview's keys moved into headers, and an address pasted into a search written as the install's own. */
async function appRequest(request: Request, here: Mount, kind: Kind): Promise<Request> {
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

  const searched = url.searchParams.get(SEARCH_KEY);
  if (searched !== null) url.searchParams.set(SEARCH_KEY, kind.ownAddress(searched, asked.origin));

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
 * @returns the piece's response with its addresses rewritten; a site's page, and a body that is no page or JSON, goes out as the piece's own stream
 */
export async function askMount(request: Request, here: Mount, look: Look): Promise<Response> {
  const response = await here.answer(await appRequest(request, here, look.kind));
  const headers = new Headers(response.headers);
  const location = headers.get("Location");
  if (location !== null) headers.set("Location", localAddress(location, { here, kind: look.kind, real: look.real }));

  const body = rewrittenBody(response, here);
  if (body === undefined) return new Response(response.body, { status: response.status, headers });

  for (const name of BODY_HEADERS) headers.delete(name);
  if (body !== "json") headers.set("Cache-Control", "no-store");

  if (body === "plain") headers.set("Content-Type", "text/html; charset=utf-8");

  return new Response(await rewriteBody(await response.text(), body, here, look, response.status), { status: response.status, headers });
}
