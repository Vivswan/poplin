// A visitor's request for a site, answered from the database and the bucket.
//
//   URL -> what it addresses   not this install's, or no site address    404
//   letter p                   no listed login behind the request        404, before anything is looked up
//   one database query         the record and the letter decide          see below
//   the page's version tag     the request holds the live version         304, with no read of the bucket
//   path -> one or two keys    no file path                              404, which a browser may keep on an open site
//   the store, key by key      the first key that holds a file answers       the body goes out as the store gave it
//   the file's own tag         the request holds the file as it is         304, and the store opens no body: it is asked with the tag
//   several tags, or `*`       the store compares one tag                  the file is looked at first, and read after that when the request holds another
//   the store's tag of a page  no page goes out with it                    the page is read a second time, as if no tag was sent
//   no key holds a file        the path is the site's `/favicon.ico`      poplin's own icon with status 200, kept an hour, at no further read
//                              the version holds a `404.html`              one more read, of that page, sent with status 404; the plain 404 for a version without one, at no read
//                              a page for a request that holds another version carries `Clear-Site-Data`, so the browser drops that version's files
// A request asks the store three times at most: the live version's record says whether it holds a `404.html` and which files without an extension, so no key is tried that cannot hold a file.
//   a path, at most two keys         one miss, then a file at two calls at most; or two misses, then the `404.html`
//   files with no extension unkept   such a path has three keys. The third is read once and whole: a `Range` is not followed, and a held file is found by its tag after the read. Three misses are the plain 404
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
import { MISSING_PAGE, type VersionContents } from "@poplin/core/src/records/version-contents";
import { type ByteRange, type ObjectInfo, type ObjectKey, type ObjectStore, type ReadResult, resolveRange } from "@poplin/core/src/storage/storage";
import { uint8ArrayToHex } from "uint8array-extras";
import type { Addressed, SiteAddresses } from "./addresses";
import { DEFAULT_ICON, DEFAULT_ICON_TYPE } from "./default-icon";
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

/** The path of the page a site shows in place of a file it does not hold: the one at its top. */
const MISSING_PAGE_PATH = `/${MISSING_PAGE}`;

/** The one path a browser asks a site for an icon at when its page names none. */
const ICON_PATH = "/favicon.ico";

/** Poplin's own icon as it goes out. */
const ICON_BYTES = new TextEncoder().encode(DEFAULT_ICON);

/** How many seconds a browser keeps poplin's own icon: an hour, so the icon a site is published with later shows within it. */
const ICON_SECONDS = 3600;

/** The most calls one request makes to the store, whatever it asks for. What a day of requests can cost the store is counted from this. */
export const MOST_STORE_CALLS = 3;

/** The most keys a request tries and still reads each as it was asked: a miss, and then a file at two calls. A third key is read once and whole. */
const MOST_KEYS_AS_ASKED = MOST_STORE_CALLS - 1;

/** What a file read whole goes out with in place of `bytes`: a part of it cannot be asked for. */
const NO_RANGES = "none";

/** What a weak tag starts with; it names the same file. */
const WEAK = /^W\//;

/** A tag as a header carries it: in quotes. */
const QUOTED = /^".*"$/;

/** The tag that stands for whatever file an address holds. */
const ANY_FILE = "*";

/** A file the store held at one call and not at the next: its version stopped being kept in between. */
const GONE = { kind: "gone" } as const;

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
type Verdict = { readonly kind: "serve"; readonly site: Site; readonly contents: VersionContents } | { readonly kind: "move"; readonly to: string } | { readonly kind: "none" };

/** What reading a file for a request gave: the store's answer, or `gone` for a file that went between two calls for it. */
type Read = ReadResult | typeof GONE;

/** A site with what its files are served under. */
interface Served {
  /** The site the address and the record gave. */
  readonly site: Site;

  /** What the site's live version is known to hold. */
  readonly contents: VersionContents;

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

function findSite(address: SiteAddress, serving: Serving): ReturnType<Serving["database"]["findServed"]> {
  if (address.kind === "public-name") return serving.database.findServed({ public_name: address.name }, serving.now());

  return serving.database.findServed({ id: address.id }, serving.now());
}

/** What the address and the record give: the site to serve, the same label under the other letter, or nothing. */
function verdictOf(address: SiteAddress, found: Awaited<ReturnType<typeof findSite>>, addresses: SiteAddresses): Verdict {
  if (address.kind === "public-name") return found?.site.access === "public" ? { kind: "serve", ...found } : NOT_FOUND;

  const isPrivate = found?.site.access === "private";
  if (address.letter !== "p") return found === undefined || isPrivate ? { kind: "move", to: addresses.letterFormOf(address, "p") } : { kind: "serve", ...found };

  if (found === undefined) return NOT_FOUND;

  return isPrivate ? { kind: "serve", ...found } : { kind: "move", to: addresses.letterFormOf(address, "u") };
}

function requestedRange(headers: Headers): ByteRange | undefined {
  // The validator of `If-Range` is not compared, so such a request gets the whole file, which is always a correct answer to it.
  if (headers.has("If-Range")) return undefined;

  return parseRange(headers.get("Range"));
}

/** The tags a request holds, from its `If-None-Match`: each in its quotes and without a weak mark, or the one that stands for any file. */
function sentTags(header: string | null): readonly string[] {
  if (header === null) return [];

  return header
    .split(",")
    .map((tag) => tag.trim().replace(WEAK, ""))
    .filter((tag) => tag === ANY_FILE || QUOTED.test(tag));
}

/** The tag a file goes out with. A page's is its site's live version; every other file's is the store's own. */
function fileTag(info: ObjectInfo, served: Served): string {
  return isPage(info.contentType) ? served.tag : `"${info.etag}"`;
}

function holdsFile(sent: readonly string[], info: ObjectInfo, served: Served): boolean {
  return sent.includes(ANY_FILE) || sent.includes(fileTag(info, served));
}

function fileHeaders(info: ObjectInfo, served: Served): Headers {
  const headers = siteHeaders({ site: served.site, contentType: info.contentType, settings: served.serving.settings, addresses: served.serving.addresses });
  headers.set("ETag", fileTag(info, served));
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

/** Decide whether the keys a request tried are the one the site's own icon would sit at, however the path spelled it. */
function asksForIcon(keys: readonly ObjectKey[], served: Served): boolean {
  const [icon] = fileKeys(served.site, ICON_PATH, served.contents);

  return keys.length === 1 && keys[0] === icon;
}

/**
 * Answer poplin's own icon for a served site that holds none, at no call to the store. It goes out whole, under the headers a drawing of the site would carry, and is kept an hour where a drawing is kept a day.
 *
 * @returns 304 for a request that holds the icon, by its tag or the one for any file
 */
async function defaultIcon(request: Request, served: Served): Promise<Response> {
  const headers = siteHeaders({ site: served.site, contentType: DEFAULT_ICON_TYPE, settings: served.serving.settings, addresses: served.serving.addresses });
  const tag = `"${uint8ArrayToHex(await crypto.subtle.digest("SHA-256", ICON_BYTES))}"`;
  headers.set("ETag", tag);
  headers.set("Accept-Ranges", NO_RANGES);
  headers.set("Cache-Control", `${served.site.access === "private" ? "private" : "public"}, max-age=${ICON_SECONDS}`);

  const sent = sentTags(request.headers.get("If-None-Match"));
  if (sent.includes(ANY_FILE) || sent.includes(tag)) return new Response(null, { status: 304, headers });

  headers.set("Content-Length", String(ICON_BYTES.length));

  return new Response(request.method === "HEAD" ? null : ICON_BYTES, { status: 200, headers });
}

/** The 404 for a file a served site does not hold. It comes after the site was found and its letter matched, so it tells nothing a file of the site would not. */
async function missingFile(request: Request, keys: readonly ObjectKey[], served: Served): Promise<Response> {
  // The site was found and its letter matched before any key was tried, so the icon tells nothing a file of the site would not.
  if (asksForIcon(keys, served)) return defaultIcon(request, served);

  const without = plain(request, 404, { "Cache-Control": missingFileCache(served.site) });
  // A version without the page costs no read, and a request that tried three keys has none left.
  if (!served.contents.missing_page || keys.length > MOST_KEYS_AS_ASKED) return without;

  const [key] = fileKeys(served.site, MISSING_PAGE_PATH, served.contents);
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

/** Read a file the store was already asked about. A range that selects no byte of it is answered from what the store said, at no further call; a file that went since is `gone`. */
async function readKnown(key: ObjectKey, range: ByteRange | undefined, info: ObjectInfo, served: Served): Promise<Read> {
  if (range !== undefined && resolveRange(range, info.size) === "unsatisfiable") return { kind: "range-not-satisfiable", info };

  const read = await served.serving.store.read(key, range === undefined ? {} : { range });

  return read.kind === "missing" ? GONE : read;
}

/**
 * Read a file for a request, unless the request holds it: `not-modified` then, and the store opened no body. A file costs the store two calls at most.
 *
 * The store compares one tag. A request that holds several, or the one for any file, costs a look at the file first, and a read after it when it holds another.
 */
async function readUnlessHeld(key: ObjectKey, range: ByteRange | undefined, sent: readonly string[], served: Served): Promise<Read> {
  const { store } = served.serving;
  const asked = range === undefined ? {} : { range };
  const [only] = sent;
  if (only === undefined) return store.read(key, asked);

  if (sent.length > 1 || only === ANY_FILE) {
    const looked = await store.head(key);
    if (looked.kind === "missing") return looked;

    return holdsFile(sent, looked.info, served) ? { kind: "not-modified", info: looked.info } : readKnown(key, range, looked.info, served);
  }

  const result = await store.read(key, { ...asked, ifNoneMatch: only.slice(1, -1) });
  if (result.kind !== "not-modified" || !isPage(result.info.contentType)) return result;

  // No page ever went out with the store's tag, so a request that sends it holds no page: it is read again as if it sent none.
  return readKnown(key, range, result.info, served);
}

/**
 * Answer from a third key, at the one call two misses left: the file whole, or 304 for one the request holds.
 *
 * A `Range` is not followed, which HTTP allows, and the file says so. The request's tags are compared once the file is read, so a 304 here opened a body and closed it.
 *
 * @returns `undefined` when the key holds no file
 */
async function answerWhole(request: Request, key: ObjectKey, served: Served): Promise<Response | undefined> {
  const sent = sentTags(request.headers.get("If-None-Match"));
  const result = await served.serving.store.read(key, {});
  if (result.kind !== "found") return undefined;

  const held = holdsFile(sent, result.info, served);
  if (held) await result.body.cancel();

  const response = answerRead(request, held ? { kind: "not-modified", info: result.info } : result, served, false);
  response.headers.set("Accept-Ranges", NO_RANGES);

  return response;
}

function answerRead(request: Request, result: Exclude<ReadResult, { readonly kind: "missing" }>, served: Served, ranged: boolean): Response {
  const headers = fileHeaders(result.info, served);

  if (result.kind === "not-modified") return new Response(null, { status: 304, headers });

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
  const sent = sentTags(request.headers.get("If-None-Match"));

  for (const key of keys.slice(0, MOST_KEYS_AS_ASKED)) {
    const result = await readUnlessHeld(key, range, sent, served);
    if (result.kind === "missing") continue;

    // A file that went between two calls for it took both: nothing more is asked of the store.
    if (result.kind === "gone") return plain(request, 404, { "Cache-Control": missingFileCache(served.site) });

    return answerRead(request, result, served, range !== undefined);
  }

  const [last] = keys.slice(MOST_KEYS_AS_ASKED);
  const whole = last === undefined ? undefined : await answerWhole(request, last, served);

  return whole ?? missingFile(request, keys, served);
}

async function answerHead(request: Request, keys: readonly ObjectKey[], served: Served): Promise<Response> {
  for (const key of keys) {
    const result = await served.serving.store.head(key);
    if (result.kind === "missing") continue;

    const headers = fileHeaders(result.info, served);
    if (holdsFile(sentTags(request.headers.get("If-None-Match")), result.info, served)) return new Response(null, { status: 304, headers });

    headers.set("Content-Length", String(result.info.size));

    return new Response(null, { status: 200, headers });
  }

  return missingFile(request, keys, served);
}

/**
 * Answer a visitor's request for a site of an install, at three calls to the store at most. A served site that holds no `favicon.ico` is answered poplin's own icon there.
 * Any other 404 for a file a served site does not hold carries the site's own `404.html` when its live version has one.
 *
 * An address with nothing after what names the site is answered 302 to itself and a slash, so a page's relative links stay inside the site.
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

  // Asked before any lookup, so the move tells nothing of a site.
  if (address.path === "") return redirect(`${url.origin}${url.pathname}/${url.search}`);

  const verdict = verdictOf(address, await findSite(address, serving), serving.addresses);
  if (verdict.kind === "none") return plain(request, 404);

  if (verdict.kind === "move") return redirect(`${verdict.to}${address.path}${url.search}`);

  const tag = versionTag(verdict.site);
  const held = heldVersion(request.headers.get("If-None-Match"), tag);
  if (held === "same") return unchangedPage(verdict.site, serving, tag);

  const served = { site: verdict.site, contents: verdict.contents, serving, tag, held };
  const keys = fileKeys(verdict.site, address.path, verdict.contents);
  if (request.method === "HEAD") return answerHead(request, keys, served);

  return answerGet(request, keys, served);
}
