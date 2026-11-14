// The limits on site traffic: may this request proceed, or must it wait, and for how long.
//
//   visitor      one visitor, one minute       visitor_requests_per_minute
//   site         one site, one minute          site_requests_per_minute
//   day          all sites, one UTC day        requests_per_day
//   site-share   one site, one UTC day         site_share_of_day percent of requests_per_day
//
// The checks run in that order and stop at the first refusal, so a refused request never touches a counter below its own row.
// The day's two checks and the count are one step with nothing awaited in it, so of requests that arrive together only as many pass as the day has room for.
// A request that passes is in the day's count at once, and is written once it is answered, with whether it opened a page.
// The one count feeds the day's limits and a site's views.
// A refused request is still a request the Worker answered: the limits keep visitors and sites fair to each other, they do not save Cloudflare's own daily quota.
// A counter that cannot answer lets the request through: a site keeps working when its counters do not.

import type { RequestCounts } from "@poplin/core/src/database/database";
import { secondsToNextDay } from "@poplin/core/src/database/driver";
import type { SettingValues } from "@poplin/core/src/records/settings";
import { dayOf } from "@poplin/core/src/records/views";
import type { SiteId } from "@poplin/core/src/sites/ids";

import { isPageTag } from "../sites/headers";
import type { VisitorKey } from "./visitor-key";

const PERCENT = 100;
const TAKEN: Taken = { ok: true };
const PAGE_STATUSES: ReadonlySet<number> = new Set([200, 304]);

/** One count of requests over a minute: a visitor's, or a site's. */
export interface MinuteWindow {
  /** Which of the two per-minute limits it counts for. */
  readonly scope: "visitor" | "site";

  /** Whose count it is: a visitor key or a site id. */
  readonly key: string;

  /** The most requests the minute takes. */
  readonly limit: number;
}

/** One site's requests and all sites' requests over one UTC day. */
export interface DayWindow {
  /** The UTC date, such as `2026-11-13`. */
  readonly day: string;

  /** The site whose own count is read or added to. */
  readonly site: SiteId;
}

/** The room a day has: the most requests of all sites together, and the most of the one site. */
export interface DayRoom {
  readonly all: number;
  readonly site: number;
}

/** One answered request of the day's sample, to write. */
export interface CountedDay extends DayWindow {
  /** How many requests it stands for, from `sampleDay`: a whole number of at least 1. */
  readonly requests: number;

  /** Whether the request opened a page, which a site's views count. */
  readonly page: boolean;
}

/** Whether a request fit into its minute, and when to come back if it did not. */
export type Taken = { readonly ok: true } | { readonly ok: false; readonly retryAfterSeconds: number };

/** Where the counts live. Every method takes the time in milliseconds since the epoch and rejects when the counter cannot answer. */
export interface Counters {
  /**
   * Count one request against a minute.
   *
   * @returns whether it fit; a request that did not fit is not counted
   */
  takeMinute(window: MinuteWindow, now: number): Promise<Taken>;

  /** The day's counts so far. Nothing is counted. */
  readDay(window: DayWindow, now: number): Promise<RequestCounts>;

  /**
   * Take one request into the day's count before it is answered, only while the day and its site have room. Nothing is awaited: no other request is checked in between.
   *
   * The counts it checks are the ones `readDay` last brought in, and every request taken since.
   *
   * @returns how many requests the request stands for in the day's sample, 0 for one the sample leaves out, or the limit that is full, which takes nothing
   * @throws when the counter cannot answer
   */
  sampleDay(window: DayWindow, room: DayRoom, now: number): number | "day" | "site-share";

  /** Write a sampled request to the day's count of its site and of all sites together, and to its site's views when it opened a page. */
  countDay(counted: CountedDay, now: number): Promise<void>;
}

/** A request that must wait: the limit that refused it and how long until that limit takes requests again. */
export interface Refusal {
  readonly ok: false;
  readonly which: "visitor" | "site" | "day" | "site-share";
  readonly retryAfterSeconds: number;
}

/** A request that may proceed, with how many requests the day's sample counts it for, or the limit that refused it. */
type Verdict = { readonly ok: true; readonly requests: number } | Refusal;

/** One request for a site, and the settings in force. */
interface Asked {
  /** The four limits, as the install's settings hold them now. */
  readonly settings: Pick<SettingValues, "visitor_requests_per_minute" | "site_requests_per_minute" | "requests_per_day" | "site_share_of_day">;

  /** The site the request is for. */
  readonly site: SiteId;

  /** Who asks, from `visitorKey`. */
  readonly visitor: VisitorKey;

  /** The time of the request, in milliseconds since the epoch. */
  readonly now: number;
}

/** The most requests one site takes of a day: its share of the day, and never less than one request. */
function siteShare(settings: Asked["settings"]): number {
  return Math.max(1, Math.floor((settings.requests_per_day * settings.site_share_of_day) / PERCENT));
}

async function takenOrOpen(counters: Counters, window: MinuteWindow, now: number): Promise<Taken> {
  try {
    return await counters.takeMinute(window, now);
  } catch {
    return TAKEN;
  }
}

/** Bring the day's counts in for the check that follows. A counter that cannot answer leaves the check with what it has. */
async function refreshDay(counters: Counters, window: DayWindow, now: number): Promise<void> {
  await counters.readDay(window, now).catch(() => undefined);
}

/** Take a request into the day's count while there is room. A counter that cannot answer lets it through, uncounted. */
function takeDay(counters: Counters, window: DayWindow, room: DayRoom, now: number): ReturnType<Counters["sampleDay"]> {
  try {
    return counters.sampleDay(window, room, now);
  } catch {
    return 0;
  }
}

/**
 * Decide whether a request for a site may proceed, and count it against its minutes and its day when it may. `countRequest` writes the day's count once the request is answered.
 *
 * @returns `ok` with `requests`, what `countRequest` is handed, or the first limit that refused in the order visitor, site, day, site-share; a day limit is lifted at the next midnight UTC
 */
export async function checkLimits(asked: Asked, counters: Counters): Promise<Verdict> {
  const { settings, site, now } = asked;

  const visitor = await takenOrOpen(counters, { scope: "visitor", key: asked.visitor, limit: settings.visitor_requests_per_minute }, now);
  if (!visitor.ok) return { ok: false, which: "visitor", retryAfterSeconds: visitor.retryAfterSeconds };

  const ofSite = await takenOrOpen(counters, { scope: "site", key: site, limit: settings.site_requests_per_minute }, now);
  if (!ofSite.ok) return { ok: false, which: "site", retryAfterSeconds: ofSite.retryAfterSeconds };

  const day: DayWindow = { day: dayOf(now), site };
  await refreshDay(counters, day, now);

  const taken = takeDay(counters, day, { all: settings.requests_per_day, site: siteShare(settings) }, now);
  if (typeof taken === "string") return { ok: false, which: taken, retryAfterSeconds: secondsToNextDay(now) };

  return { ok: true, requests: taken };
}

/**
 * Decide whether an answer opened a page of a site: a `GET` answered 200 with a page, or 304 for one the visitor already holds. Serving tags a page, and no other file, with its site's version.
 *
 * A `HEAD`, a part of a file, a redirect, and every refusal open nothing. A page a cache answered never reaches this code, so it is not counted.
 */
export function isPageView(request: Request, response: Response): boolean {
  if (request.method !== "GET" || !PAGE_STATUSES.has(response.status)) return false;

  return isPageTag(response.headers.get("ETag"));
}

/**
 * Write a sampled request once it is answered: to the day of its site and of all sites, and as a view when it opened a page.
 *
 * Nothing of the visitor is counted or kept: no address, no key, no header. A count that fails is one request uncounted, never a request refused.
 *
 * @param counted - the site that answered, the time of the request, the `requests` `checkLimits` answered for it, and whether the answer was a page, from `isPageView`
 */
export async function countRequest(
  counted: { readonly site: SiteId; readonly now: number; readonly requests: number; readonly page: boolean },
  counters: Pick<Counters, "countDay">,
): Promise<void> {
  if (counted.requests === 0) return;

  await counters.countDay({ day: dayOf(counted.now), site: counted.site, requests: counted.requests, page: counted.page }, counted.now).catch(() => undefined);
}
