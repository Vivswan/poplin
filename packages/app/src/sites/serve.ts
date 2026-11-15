// A visitor's request for a site, answered from the database and the bucket.
//
//   URL -> what it addresses   not this install's, or no site address    404
//   letter p                   no listed login behind the request        404, before anything is looked up
//   one database query         the record and the letter decide          see below
//   the page's version tag     the request holds the live version         304, with no read of the bucket
//   path -> one to three keys  no file path                              404, which a browser may keep on an open site
//   one bucket read per key    the body goes out as the store gave it; three reads at most, for a path without an extension, and one for every other
//   no key holds a file        one more read, of the site's own `404.html`   that page with status 404; the plain 404 for a site without one
//                              a page for a request that holds another version carries `Clear-Site-Data`, so the browser drops that version's files
//
//   letter u, or none   the site is unlisted or public    the file
//                       private, or no served site        302 to the same label under p
//   letter p            the site is private               the file
//                       unlisted or public                302 to the same label under u
//                       no served site                    404
//   public name         the site is public                the file
//
// A label's name is never compared: the id alone names the site. Under u a private site, a site in the trash, an expired one, and no site at all answer alike, so an id cannot be probed.

import type { Database } from "@poplin/core/src/database/database";
import type { SettingValues } from "@poplin/core/src/records/settings";
import type { Site } from "@poplin/core/src/records/site";
import type { ByteRange, ObjectInfo, ObjectKey, ObjectStore, ReadResult } from "@poplin/core/src/storage/storage";
import type { Addressed, SiteAddresses } from "./addresses";
import { fileKeys } from "./file-keys";
import { clearHeldFiles, HTTPS_ALONE, heldVersion, isPage, missingFileCache, missingPageCache, siteHeaders, versionTag } from "./headers";
import { parseRange } from "./range";

/** The methods a site answers. */
const METHODS: ReadonlySet<string> = new Set(["GET", "HEAD"]);

/** The `Allow` header of a refused method. */
const ALLOW = "GET, HEAD";

/** The request headers that name the page a request came from; the first that holds an address decides. */
const REQUESTER_HEADERS = ["Origin", "Referer"] as const;

/** The headers of every answer that is not a file: never cached, never indexed, never framed, and over https alone from then on. */
const PLAIN_HEADERS = {
  "Cache-Control": "no-store",
  "Content-Security-Policy": "frame-ancestors 'none'",
  "Referrer-Policy": "no-referrer",
  "Strict-Transport-Security": HTTPS_ALONE,
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex",
} as const;

/** The whole body of each refusal. One status has one body, whatever caused it. */
const PLAIN_BODIES = {
  403: "Forbidden\n",
  404: "Not found\n",
  405: "Method not allowed\n",
  416: "Range not satisfiable\n",
} as const;

/** The path of the page a site shows in place of a file it does not hold: the one at its root. */
const MISSING_PAGE = "/404.html";

/** The verdict on an address that serves nothing. */
const NOT_FOUND: Verdict = { kind: "none" };

/** Everything a request is answered from. Nothing is read from a binding or a global. */
interface Serving {
  /** Finds the site an address serves. */
  readonly database: Pick<Database, "findServed">;

  /** Holds every site's files. */
  readonly store: Pick<ObjectStore, "head" | "read">;

  /** The install's framing setting, and whether it lets search engines in at all. */
  readonly settings: Pick<SettingValues, "outside_pages" | "search_engines_allowed">;

  /** The install's address layout. */
  readonly addresses: SiteAddresses;

  /** Decides who a request is from; `ok` is `true` only when the install's login vouches for an email that is in the logins now. */
  readonly identify: (headers: Headers) => Promise<{ readonly ok: boolean }>;

  /** The time, in milliseconds since the epoch. */
  readonly now: () => number;
}

/** An address that names a site. */
type SiteAddress = Exclude<Addressed, { readonly kind: "none" }>;

/** What a request for a site comes to, before any file is read. */
type Verdict = { readonly kind: "serve"; readonly site: Site } | { readonly kind: "move"; readonly origin: string } | { readonly kind: "none" };

/** A site with what its files are served under. */
interface Served {
  /** The site the address and the record gave. */
  readonly site: Site;

  /** What the request is answered from. */
  readonly serving: Serving;

  /** The tag of the site's live version, which every page of it carries. */
  readonly tag: string;

  /** Which version the request holds a page of: `other` is a version that is no longer live. */
  readonly held: "other" | "none";
}

function plain(request: Request, status: keyof typeof PLAIN_BODIES, extra: Readonly<Record<string, string>> = {}): Response {
  const headers = { ...PLAIN_HEADERS, "Content-Type": "text/plain; charset=utf-8", ...extra };
  if (request.method === "HEAD") return new Response(null, { status, headers });

  return new Response(PLAIN_BODIES[status], { status, headers });
}

function requesterHost(headers: Headers): string | undefined {
  for (const name of REQUESTER_HEADERS) {
    const url = URL.parse(headers.get(name) ?? "");
    if (url !== null && url.hostname !== "") return url.hostname;
  }

  return undefined;
}

// A browser marks who made a request. Opening the address itself, as the top-level page, always passes.
// It calls every hostname of the domain `same-site`, so there the requester's own hostname decides; a request that names none passes.
// A hostname that ends as a site's does is the install's: its routes take every such name, and setup refuses a zone that holds one of its own.
function isOutsideSubrequest(headers: Headers, addresses: SiteAddresses): boolean {
  const from = headers.get("Sec-Fetch-Site");
  if (from !== "cross-site" && from !== "same-site") return false;

  if (headers.get("Sec-Fetch-Mode") === "navigate" && headers.get("Sec-Fetch-Dest") === "document") return false;

  if (from === "cross-site") return true;

  const requester = requesterHost(headers);

  return requester !== undefined && !addresses.isSiteHost(requester);
}

function redirect(location: string): Response {
  return new Response(null, { status: 302, headers: { ...PLAIN_HEADERS, Location: location } });
}

function findSite(address: SiteAddress, serving: Serving): Promise<Site | undefined> {
  if (address.kind === "public-name") return serving.database.findServed({ public_name: address.name }, serving.now());

  return serving.database.findServed({ id: address.id }, serving.now());
}

/** What the address and the record give: the site to serve, the same label under the other letter, or nothing. */
function verdictOf(address: SiteAddress, site: Site | undefined, addresses: SiteAddresses): Verdict {
  if (address.kind === "public-name") return site?.access === "public" ? { kind: "serve", site } : NOT_FOUND;

  const isPrivate = site?.access === "private";
  if (address.letter !== "p") return site === undefined || isPrivate ? { kind: "move", origin: addresses.letterFormOf(address, "p") } : { kind: "serve", site };

  if (site === undefined) return NOT_FOUND;

  return isPrivate ? { kind: "serve", site } : { kind: "move", origin: addresses.letterFormOf(address, "u") };
}

function requestedRange(headers: Headers): ByteRange | undefined {
  // The validator of `If-Range` is not compared, so such a request gets the whole file, which is always a correct answer to it.
  if (headers.has("If-Range")) return undefined;

  return parseRange(headers.get("Range"));
}

function etagMatches(header: string | null, etag: string): boolean {
  if (header === null) return false;

  const sent = header.split(",").map((tag) => tag.trim().replace(/^W\//, ""));

  return sent.includes("*") || sent.includes(etag);
}

/** The headers of a file. A page's tag is its site's live version; every other file's is the store's own. */
function fileHeaders(info: ObjectInfo, served: Served): Headers {
  const headers = siteHeaders({ site: served.site, contentType: info.contentType, settings: served.serving.settings, addresses: served.serving.addresses });
  headers.set("ETag", isPage(info.contentType) ? served.tag : `"${info.etag}"`);
  headers.set("Accept-Ranges", "bytes");

  return headers;
}

/** The 304 for a request that holds a page of the live version. No file is looked at: only a page ever carried the tag, at this very address. */
function unchangedPage(site: Site, serving: Serving, tag: string): Response {
  const headers = siteHeaders({ site, contentType: "text/html", settings: serving.settings, addresses: serving.addresses });
  // A browser lays these headers over the page it holds, whose own content type may name a charset.
  headers.delete("Content-Type");
  headers.set("ETag", tag);

  return new Response(null, { status: 304, headers });
}

/** The headers of a site's own 404 page: a page's, with no tag, so no later request is answered 304 from it. */
function missingPageHeaders(info: ObjectInfo, served: Served): Headers {
  const headers = siteHeaders({ site: served.site, contentType: info.contentType, settings: served.serving.settings, addresses: served.serving.addresses });
  headers.set("Cache-Control", missingPageCache(served.site));
  headers.set("Content-Length", String(info.size));

  return headers;
}

/** The 404 for a file a served site does not hold. It comes after the site was found and its letter matched, so it tells nothing a file of the site would not. */
async function missingFile(request: Request, keys: readonly ObjectKey[], served: Served): Promise<Response> {
  const without = plain(request, 404, { "Cache-Control": missingFileCache(served.site) });

  const [key] = fileKeys(served.site, MISSING_PAGE);
  // A request for the page itself has already found it missing.
  if (key === undefined || keys.includes(key)) return without;

  if (request.method === "HEAD") {
    const result = await served.serving.store.head(key);
    if (result.kind === "missing") return without;

    return new Response(null, { status: 404, headers: missingPageHeaders(result.info, served) });
  }

  const result = await served.serving.store.read(key, {});
  if (result.kind !== "found") return without;

  const headers = missingPageHeaders(result.info, served);
  // As with a page that is found: a request for a part of a file is told to drop nothing.
  if (served.held === "other" && isPage(result.info.contentType) && requestedRange(request.headers) === undefined) clearHeldFiles(headers);

  return new Response(result.body, { status: 404, headers });
}

async function answerRead(request: Request, result: Exclude<ReadResult, { kind: "missing" }>, served: Served, ranged: boolean): Promise<Response> {
  const headers = fileHeaders(result.info, served);

  if (result.kind === "not-modified" || etagMatches(request.headers.get("If-None-Match"), headers.get("ETag") ?? "")) {
    if (result.kind === "found") await result.body.cancel();

    return new Response(null, { status: 304, headers });
  }

  if (result.kind === "range-not-satisfiable") return plain(request, 416, { "Content-Range": `bytes */${result.info.size}` });

  const { offset, length } = result.span;
  headers.set("Content-Length", String(length));
  if (ranged) {
    headers.set("Content-Range", `bytes ${offset}-${offset + length - 1}/${result.info.size}`);

    return new Response(result.body, { status: 206, headers });
  }

  if (served.held === "other" && isPage(result.info.contentType)) clearHeldFiles(headers);

  return new Response(result.body, { status: 200, headers });
}

async function answerGet(request: Request, keys: readonly ObjectKey[], served: Served): Promise<Response> {
  const range = requestedRange(request.headers);

  for (const key of keys) {
    const result = await served.serving.store.read(key, range === undefined ? {} : { range });
    if (result.kind === "missing") continue;

    return answerRead(request, result, served, range !== undefined);
  }

  return missingFile(request, keys, served);
}

async function answerHead(request: Request, keys: readonly ObjectKey[], served: Served): Promise<Response> {
  for (const key of keys) {
    const result = await served.serving.store.head(key);
    if (result.kind === "missing") continue;

    const headers = fileHeaders(result.info, served);
    if (etagMatches(request.headers.get("If-None-Match"), headers.get("ETag") ?? "")) return new Response(null, { status: 304, headers });

    headers.set("Content-Length", String(result.info.size));

    return new Response(null, { status: 200, headers });
  }

  return missingFile(request, keys, served);
}

/**
 * Answer a visitor's request for a site of an install. A 404 for a file a served site does not hold carries the site's own `404.html` when it has one.
 *
 * @returns the file with its headers, its body the store's own stream; else 304 for what the request holds, 206 or 416 for a range, 403 for a subrequest of a page that is no site of the install, 302 to the same label under the other letter, 405, or 404
 * @throws whatever the database, the store, or the identity check rejects with; nothing else throws
 */
export async function serveSite(request: Request, serving: Serving): Promise<Response> {
  if (!METHODS.has(request.method)) return plain(request, 405, { Allow: ALLOW });

  const url = new URL(request.url);
  const address = serving.addresses.resolve(url);
  if (address.kind === "none") return plain(request, 404);

  // The login stands in front of every `p` address, so a request without its proof came around it: it learns nothing, not even a redirect.
  if (address.kind === "site" && address.letter === "p" && !(await serving.identify(request.headers)).ok) return plain(request, 404);

  if (serving.settings.outside_pages === "blocked" && isOutsideSubrequest(request.headers, serving.addresses)) return plain(request, 403);

  const verdict = verdictOf(address, await findSite(address, serving), serving.addresses);
  if (verdict.kind === "none") return plain(request, 404);

  if (verdict.kind === "move") return redirect(`${verdict.origin}${url.pathname}${url.search}`);

  const tag = versionTag(verdict.site);
  const held = heldVersion(request.headers.get("If-None-Match"), tag);
  if (held === "same") return unchangedPage(verdict.site, serving, tag);

  const served = { site: verdict.site, serving, tag, held };
  const keys = fileKeys(verdict.site, address.path);
  if (request.method === "HEAD") return answerHead(request, keys, served);

  return answerGet(request, keys, served);
}
