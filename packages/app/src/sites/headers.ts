// The headers every file of a site goes out with. Each comes from the site record, the settings, or the stored content type, never from the file's bytes.
//
//   Cache-Control   private site          private, no-cache
//                   HTML                  cache_html: 0 -> no-store, else public, max-age=<seconds>
//                   every other file      cache_files: off -> no-store, else public, max-age=<seconds>

import type { SettingValues } from "@poplin/core/src/records/settings";
import type { Site } from "@poplin/core/src/records/site";
import type { SiteAddresses } from "./addresses";

/** How many seconds each unit of a cache time holds. */
const SECONDS_PER_UNIT: Readonly<Record<CacheTime["unit"], number>> = { s: 1, m: 60, h: 3600, d: 86_400 };

/** A stored content type that names an HTML page, with or without parameters, read as `Headers` sends it: without the spaces around it. */
const HTML_TYPE = /^\s*text\/html\s*(?:;|$)/i;

/** What a header value may hold; a stored content type with anything else cannot be sent. */
const SENDABLE = /^[\t\x20-\x7e\x80-\xff]*$/;

/** The content type sent for a file whose stored one cannot be: bytes a browser downloads and never renders. */
const OPAQUE_TYPE = "application/octet-stream";

/** Nothing is kept: the browser asks again every time. */
const NO_STORE = "no-store";

/** A browser may keep a private site's file but asks before every use, and a shared cache keeps nothing. */
const PRIVATE_CACHE = "private, no-cache";

/** No page may show the site in a frame. */
const FRAME_NONE = "frame-ancestors 'none'";

/** The request headers the refusal of outside pages reads, so a cache keeps the answers apart. */
const FETCH_METADATA = "Sec-Fetch-Site, Sec-Fetch-Mode, Sec-Fetch-Dest, Origin, Referer";

type CacheTime = SettingValues["cache_html"];

/** What a file's headers are decided from. */
interface FileFacts {
  /** The site the file belongs to. */
  readonly site: Pick<Site, "access" | "search_engines" | "embeddable">;

  /** The media type stored with the object. */
  readonly contentType: string;

  /** The install's cache and framing settings. */
  readonly settings: Pick<SettingValues, "cache_html" | "cache_files" | "outside_pages">;

  /** The install's addresses, which the frame rule names. */
  readonly addresses: Pick<SiteAddresses, "frameAncestors">;
}

function publicCache(time: CacheTime | "off"): string {
  if (time === "off" || time.count === 0) return NO_STORE;

  return `public, max-age=${time.count * SECONDS_PER_UNIT[time.unit]}`;
}

function cacheControl(facts: FileFacts): string {
  if (facts.site.access === "private") return PRIVATE_CACHE;

  if (HTML_TYPE.test(facts.contentType)) return publicCache(facts.settings.cache_html);

  return publicCache(facts.settings.cache_files);
}

function frameRule(facts: FileFacts): string | undefined {
  if (!facts.site.embeddable) return FRAME_NONE;

  if (facts.settings.outside_pages === "blocked") return `frame-ancestors ${facts.addresses.frameAncestors}`;

  return undefined;
}

/**
 * Build the headers of a site's file.
 *
 * @returns the content type, the hardening headers, the cache rule, and the frame rule; never an `Access-Control-Allow-*` header, so no script of another origin reads the file
 */
export function siteHeaders(facts: FileFacts): Headers {
  const headers = new Headers({
    "Content-Type": SENDABLE.test(facts.contentType) ? facts.contentType : OPAQUE_TYPE,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Cache-Control": cacheControl(facts),
  });

  const indexed = facts.site.access === "public" && facts.site.search_engines;
  if (!indexed) headers.set("X-Robots-Tag", "noindex");

  const frames = frameRule(facts);
  if (frames !== undefined) headers.set("Content-Security-Policy", frames);

  if (facts.settings.outside_pages === "blocked") headers.set("Vary", FETCH_METADATA);

  return headers;
}
