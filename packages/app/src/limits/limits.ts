// The limits on site traffic: may this request proceed, or must it wait, and for how long.
//
//   visitor      one visitor, one minute       visitor_requests_per_minute
//   site         one site, one minute          site_requests_per_minute
//   day          all sites, one UTC day        requests_per_day
//   site-share   one site, one UTC day         site_share_of_day percent of requests_per_day
//
// The checks run in that order and stop at the first refusal, so a refused request never touches a counter below its own row.
// A refused request is still a request the Worker answered: the limits keep visitors and sites fair to each other, they do not save Cloudflare's own daily quota.
// A counter that cannot answer lets the request through: a site keeps working when its counters do not.

import type { RequestCounts } from "@poplin/core/src/database/database";
import type { SettingValues } from "@poplin/core/src/records/settings";
import type { SiteId } from "@poplin/core/src/sites/ids";

import type { VisitorKey } from "./visitor-key";

const MS_PER_SECOND = 1000;
const MS_PER_DAY = 86_400_000;
const PERCENT = 100;
const ALLOWED: Verdict = { ok: true };

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

  /** Count one request against the day, for its site and for all sites together. */
  countDay(window: DayWindow, now: number): Promise<void>;
}

/** A request that must wait: the limit that refused it and how long until that limit takes requests again. */
export interface Refusal {
  readonly ok: false;
  readonly which: "visitor" | "site" | "day" | "site-share";
  readonly retryAfterSeconds: number;
}

type Verdict = { readonly ok: true } | Refusal;

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

function secondsToMidnight(now: number): number {
  return Math.ceil((MS_PER_DAY - (now % MS_PER_DAY)) / MS_PER_SECOND);
}

/** The most requests one site takes of a day: its share of the day, and never less than one request. */
function siteShare(settings: Asked["settings"]): number {
  return Math.max(1, Math.floor((settings.requests_per_day * settings.site_share_of_day) / PERCENT));
}

async function takenOrOpen(counters: Counters, window: MinuteWindow, now: number): Promise<Taken> {
  try {
    return await counters.takeMinute(window, now);
  } catch {
    return ALLOWED;
  }
}

async function dayOrOpen(counters: Counters, window: DayWindow, now: number): Promise<RequestCounts> {
  try {
    return await counters.readDay(window, now);
  } catch {
    return { site: 0, all: 0 };
  }
}

/**
 * Decide whether a request for a site may proceed, and count it when it may.
 *
 * @returns `{ ok: true }`, or the first limit that refused in the order visitor, site, day, site-share; a day limit is lifted at the next midnight UTC
 */
export async function checkLimits(asked: Asked, counters: Counters): Promise<Verdict> {
  const { settings, site, now } = asked;

  const visitor = await takenOrOpen(counters, { scope: "visitor", key: asked.visitor, limit: settings.visitor_requests_per_minute }, now);
  if (!visitor.ok) return { ok: false, which: "visitor", retryAfterSeconds: visitor.retryAfterSeconds };

  const ofSite = await takenOrOpen(counters, { scope: "site", key: site, limit: settings.site_requests_per_minute }, now);
  if (!ofSite.ok) return { ok: false, which: "site", retryAfterSeconds: ofSite.retryAfterSeconds };

  const day: DayWindow = { day: new Date(now).toISOString().slice(0, 10), site };
  const counts = await dayOrOpen(counters, day, now);
  if (counts.all >= settings.requests_per_day) return { ok: false, which: "day", retryAfterSeconds: secondsToMidnight(now) };

  if (counts.site >= siteShare(settings)) return { ok: false, which: "site-share", retryAfterSeconds: secondsToMidnight(now) };

  // A count that fails is one request uncounted, never a request refused.
  await counters.countDay(day, now).catch(() => undefined);

  return ALLOWED;
}
