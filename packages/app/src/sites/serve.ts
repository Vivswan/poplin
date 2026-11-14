// A visitor's request for a site, answered from the database and the bucket.
//
//   URL -> what it addresses   not this install's, or no site address    404
//   one database query         no served site, or another name           404, or the login for a label without a session
//   access                     private without a session                 the login
//   path -> one to three keys  no file path                              404
//   one bucket read per key    the body goes out as the store gave it; three reads at most, for a path without an extension, and one for every other
//
// A label without a session answers the same whether its site is private, in the trash, expired, or was never made, so an id cannot be probed.

import type { Database } from "@poplin/core/src/database/database";
import type { SettingValues } from "@poplin/core/src/records/settings";
import type { Site } from "@poplin/core/src/records/site";
import type { ByteRange, ObjectInfo, ObjectKey, ObjectStore, ReadResult } from "@poplin/core/src/storage/storage";
import type { Addressed, SiteAddresses } from "./addresses";
import { fileKeys } from "./file-keys";
import { siteHeaders } from "./headers";
import { parseRange } from "./range";

/** The methods a site answers. */
const METHODS: ReadonlySet<string> = new Set(["GET", "HEAD"]);

/** The `Allow` header of a refused method. */
const ALLOW = "GET, HEAD";

/** The request headers that name the page a request came from; the first that holds an address decides. */
const REQUESTER_HEADERS = ["Origin", "Referer"] as const;

/** The headers of every answer that is not a file: never cached, never indexed, never framed. */
const PLAIN_HEADERS = {
  "Cache-Control": "no-store",
  "Content-Security-Policy": "frame-ancestors 'none'",
  "Referrer-Policy": "no-referrer",
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

/** Everything a request is answered from. Nothing is read from a binding or a global. */
interface Serving {
  /** Finds the site an address serves. */
  readonly database: Pick<Database, "findServed">;

  /** Holds every site's files. */
  readonly store: Pick<ObjectStore, "head" | "read">;

  /** The install's cache and framing settings. */
  readonly settings: Pick<SettingValues, "cache_html" | "cache_files" | "outside_pages">;

  /** The install's address layout. */
  readonly addresses: SiteAddresses;

  /** Decides whether a request carries a valid session; `ok` is `true` for a logged-in owner. */
  readonly readSession: (headers: Headers) => Promise<{ readonly ok: boolean }>;

  /** The time, in milliseconds since the epoch. */
  readonly now: () => number;

  /** Answers the gallery's address; absent, that address is not found. */
  readonly gallery?: (request: Request) => Promise<Response>;
}

/** A site with what its files are served under. */
interface Served {
  readonly site: Site;
  readonly serving: Serving;
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
function isOutsideSubrequest(headers: Headers, addresses: SiteAddresses): boolean {
  const from = headers.get("Sec-Fetch-Site");
  if (from !== "cross-site" && from !== "same-site") return false;

  if (headers.get("Sec-Fetch-Mode") === "navigate" && headers.get("Sec-Fetch-Dest") === "document") return false;

  if (from === "cross-site") return true;

  const requester = requesterHost(headers);

  return requester !== undefined && !addresses.isSiteHost(requester);
}

async function findSite(address: Exclude<Addressed, { readonly kind: "gallery" | "none" }>, serving: Serving): Promise<Site | undefined> {
  if (address.kind === "public-name") return serving.database.findServed({ public_name: address.name }, serving.now());

  const site = await serving.database.findServed({ id: address.id }, serving.now());
  if (site?.name !== address.name) return undefined;

  return site;
}

function requestedRange(headers: Headers): ByteRange | undefined {
  // The validator of `If-Range` is not compared, so such a request gets the whole file, which is always a correct answer to it.
  if (headers.has("If-Range")) return undefined;

  return parseRange(headers.get("Range"));
}

function etagMatches(header: string | null, info: ObjectInfo): boolean {
  if (header === null) return false;

  const sent = header.split(",").map((tag) => tag.trim().replace(/^W\//, ""));

  return sent.includes("*") || sent.includes(`"${info.etag}"`);
}

function fileHeaders(info: ObjectInfo, served: Served): Headers {
  const headers = siteHeaders({ site: served.site, contentType: info.contentType, settings: served.serving.settings, addresses: served.serving.addresses });
  headers.set("ETag", `"${info.etag}"`);
  headers.set("Accept-Ranges", "bytes");

  return headers;
}

async function answerRead(request: Request, result: Exclude<ReadResult, { kind: "missing" }>, served: Served, ranged: boolean): Promise<Response> {
  const headers = fileHeaders(result.info, served);

  if (result.kind === "not-modified" || etagMatches(request.headers.get("If-None-Match"), result.info)) {
    if (result.kind === "found") await result.body.cancel();

    return new Response(null, { status: 304, headers });
  }

  if (result.kind === "range-not-satisfiable") return plain(request, 416, { "Content-Range": `bytes */${result.info.size}` });

  const { offset, length } = result.span;
  headers.set("Content-Length", String(length));
  if (!ranged) return new Response(result.body, { status: 200, headers });

  headers.set("Content-Range", `bytes ${offset}-${offset + length - 1}/${result.info.size}`);

  return new Response(result.body, { status: 206, headers });
}

async function answerGet(request: Request, keys: readonly ObjectKey[], served: Served): Promise<Response> {
  const range = requestedRange(request.headers);

  for (const key of keys) {
    const result = await served.serving.store.read(key, range === undefined ? {} : { range });
    if (result.kind === "missing") continue;

    return answerRead(request, result, served, range !== undefined);
  }

  return plain(request, 404);
}

async function answerHead(request: Request, keys: readonly ObjectKey[], served: Served): Promise<Response> {
  for (const key of keys) {
    const result = await served.serving.store.head(key);
    if (result.kind === "missing") continue;

    const headers = fileHeaders(result.info, served);
    if (etagMatches(request.headers.get("If-None-Match"), result.info)) return new Response(null, { status: 304, headers });

    headers.set("Content-Length", String(result.info.size));

    return new Response(null, { status: 200, headers });
  }

  return plain(request, 404);
}

/**
 * Answer a visitor's request for a site of an install.
 *
 * @returns the file with its headers, its body the store's own stream; else 304, 206 or 416 for a range, 403 for a subrequest of a page that is no site of the install, 302 to the login, 405, or the one 404
 * @throws whatever the database, the store, or the session reader rejects with; nothing else throws
 */
export async function serveSite(request: Request, serving: Serving): Promise<Response> {
  if (!METHODS.has(request.method)) return plain(request, 405, { Allow: ALLOW });

  const url = new URL(request.url);
  const address = serving.addresses.resolve(url);
  if (address.kind === "none") return plain(request, 404);

  if (serving.settings.outside_pages === "blocked" && isOutsideSubrequest(request.headers, serving.addresses)) return plain(request, 403);

  if (address.kind === "gallery") return (await serving.gallery?.(request)) ?? plain(request, 404);

  const site = await findSite(address, serving);

  if (site === undefined || site.access === "private") {
    const session = await serving.readSession(request.headers);
    if (!session.ok && address.kind === "site") return new Response(null, { status: 302, headers: { ...PLAIN_HEADERS, Location: serving.addresses.loginFor(url) } });

    if (!session.ok) return plain(request, 404);
  }

  if (site === undefined) return plain(request, 404);

  const keys = fileKeys(site, address.path);
  if (request.method === "HEAD") return answerHead(request, keys, { site, serving });

  return answerGet(request, keys, { site, serving });
}
