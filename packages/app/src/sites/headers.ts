// The headers every file of a site goes out with. Each comes from the site record, the settings, or the stored content type, never from the file's bytes.
//
//   Cache-Control   a page (HTML)         5 minutes, then asked again; on a private site asked again every time
//                   every other file      a day
//                   a missing file        a day; no-store on a private site
//                   the site's 404 page   as a page of an open site; no-store on a private site
//                   a private site        `private` in place of `public`: a browser keeps it, a shared cache never
//
//   ETag            a page                the live version, so an unchanged page is answered without a read of the bucket
//                   every other file      the store's own
//
// A browser that asks for a page with the tag of another version holds files of that version: the page it gets tells it to drop them.

import type { SettingValues } from "@poplin/core/src/records/settings";
import type { Site } from "@poplin/core/src/records/site";
import type { SiteAddresses } from "./addresses";

/** A stored content type that names an HTML page, with or without parameters, read as `Headers` sends it: without the spaces around it. */
const HTML_TYPE = /^\s*text\/html\s*(?:;|$)/i;

/** What a header value may hold; a stored content type with anything else cannot be sent. */
const SENDABLE = /^[\t\x20-\x7e\x80-\xff]*$/;

/** The content type sent for a file whose stored one cannot be: bytes a browser downloads and never renders. */
const OPAQUE_TYPE = "application/octet-stream";

/** Nothing is kept: the browser asks again every time. */
const NO_STORE = "no-store";

/** How long a browser shows a page of an open site before it asks again, in seconds. */
const PAGE_SECONDS = 5 * 60;

/** The cache rule of a page of an open site. */
const OPEN_PAGE_CACHE = `public, max-age=${PAGE_SECONDS}, must-revalidate`;

/** How long a browser keeps every other file, and remembers that one is missing, in seconds. */
const FILE_SECONDS = 24 * 60 * 60;

/** A version tag: the letter `v`, the version's number, a dash, and the moment it was published in base 36. */
const VERSION_TAG = /^"v[0-9]+-[0-9a-z]+"$/;

/** What a weak tag starts with; a cache in between may weaken a tag, and it names the same version. */
const WEAK = /^W\//;

/** The header that tells a browser to drop what it holds of the site, and what it drops: the cached files. */
const CLEAR_CACHE = ["Clear-Site-Data", '"cache"'] as const;

/** A browser that got any answer of a site asks for it over https alone for 180 days, as the dashboard has it. It names this hostname alone: the domain is the person's own and holds other things. */
export const HTTPS_ALONE = "max-age=15552000";

/** No page may show the site in a frame. */
const FRAME_NONE = "frame-ancestors 'none'";

/** The request headers the refusal of outside pages reads, so a cache keeps the answers apart. */
const FETCH_METADATA = "Sec-Fetch-Site, Sec-Fetch-Mode, Sec-Fetch-Dest, Origin, Referer";

/** What a file's headers are decided from. */
interface FileFacts {
  /** The site the file belongs to. */
  readonly site: Pick<Site, "access" | "search_engines" | "embeddable">;

  /** The media type stored with the object. */
  readonly contentType: string;

  /** The install's framing setting, and whether it lets search engines in at all. */
  readonly settings: Pick<SettingValues, "outside_pages" | "search_engines_allowed">;

  /** The install's addresses, which the frame rule names. */
  readonly addresses: Pick<SiteAddresses, "frameAncestors">;
}

function cacheControl(facts: FileFacts): string {
  const scope = facts.site.access === "private" ? "private" : "public";
  if (!isPage(facts.contentType)) return `${scope}, max-age=${FILE_SECONDS}`;

  // Whoever may open a private site is still editing it, so its page is asked for again on every open.
  if (facts.site.access === "private") return "private, no-cache";

  return OPEN_PAGE_CACHE;
}

/**
 * Decide whether a stored content type names a page: an HTML document, which a browser opens and which names the site's other files.
 */
export function isPage(contentType: string): boolean {
  return HTML_TYPE.test(contentType);
}

/**
 * Decide whether an entity tag is one only a page carries: a version's. An answer with it, the 304 for an unchanged page included, is a page.
 *
 * @param tag - an answer's `ETag`, or `null` for none
 */
export function isPageTag(tag: string | null): boolean {
  return tag !== null && VERSION_TAG.test(tag.replace(WEAK, ""));
}

/**
 * Write the tag every page of a site carries while one version is live.
 *
 * @returns a quoted entity tag that differs between any two versions of the site, a version gone back to included
 */
export function versionTag(site: Pick<Site, "live_version" | "versions">): string {
  const live = site.versions.find((version) => version.number === site.live_version);

  return `"v${site.live_version}-${(live?.published_at ?? 0).toString(36)}"`;
}

/**
 * Read which version of a site a request holds a page of.
 *
 * @param header - the request's `If-None-Match`, or `null` for none
 * @param tag - the live version's tag, from `versionTag`
 * @returns `same` when a tag sent is the live version's, `other` when none is and one is a version tag, and `none` for a request that holds no page
 */
export function heldVersion(header: string | null, tag: string): "same" | "other" | "none" {
  const sent = (header ?? "").split(",").map((each) => each.trim().replace(WEAK, ""));
  if (sent.includes(tag)) return "same";

  return sent.some((each) => VERSION_TAG.test(each)) ? "other" : "none";
}

/**
 * Tell a browser that holds files of another version to drop them, on the page that brings the live one.
 */
export function clearHeldFiles(headers: Headers): void {
  headers.set(...CLEAR_CACHE);
}

/**
 * Write the cache rule of the 404 for a file a site does not hold, so a browser does not ask for a missing file on every page view.
 *
 * @returns a day on an open site, so a file published later shows within it, and `no-store` on a private site
 */
export function missingFileCache(site: Pick<Site, "access">): string {
  if (site.access === "private") return NO_STORE;

  return `public, max-age=${FILE_SECONDS}`;
}

/**
 * Write the cache rule of a site's own 404 page, so a file published later shows as soon as a page would.
 *
 * @returns what a page of an open site gets, and `no-store` on a private site
 */
export function missingPageCache(site: Pick<Site, "access">): string {
  if (site.access === "private") return NO_STORE;

  return OPEN_PAGE_CACHE;
}

function frameRule(facts: FileFacts): string | undefined {
  if (!facts.site.embeddable) return FRAME_NONE;

  if (facts.settings.outside_pages === "blocked") return `frame-ancestors ${facts.addresses.frameAncestors}`;

  return undefined;
}

/**
 * Build the headers of a site's file.
 *
 * @returns the content type, the hardening headers, the https rule, the cache rule, and the frame rule, with no entity tag; never an `Access-Control-Allow-*` header, so no script of another origin reads the file
 */
export function siteHeaders(facts: FileFacts): Headers {
  const headers = new Headers({
    "Content-Type": SENDABLE.test(facts.contentType) ? facts.contentType : OPAQUE_TYPE,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Strict-Transport-Security": HTTPS_ALONE,
    "Cache-Control": cacheControl(facts),
  });

  // A search engine may list a file only when the install lets search engines in and the public site asks for it.
  const indexed = facts.site.access === "public" && facts.site.search_engines && facts.settings.search_engines_allowed;
  if (!indexed) headers.set("X-Robots-Tag", "noindex");

  const frames = frameRule(facts);
  if (frames !== undefined) headers.set("Content-Security-Policy", frames);

  if (facts.settings.outside_pages === "blocked") headers.set("Vary", FETCH_METADATA);

  return headers;
}
