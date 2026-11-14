// The counters of a deployed install, on what Cloudflare's Free plan gives without a bill.
//
//   a minute   the Workers rate limiting binding. Its limit is fixed in wrangler.jsonc, so each request weighs
//              `BINDING_LIMIT / setting`, rounded up, and the binding fills up after `setting` requests.
//              Up to 1,000 a minute that is exact. Above it the minute closes early, never late, by at most one
//              part in `BINDING_LIMIT / setting`: 2,000 for 2,001, about 83,000 for 90,000.
//              A changed setting weighs the requests after it; the minute already running keeps what it has.
//              Cloudflare counts per location and catches up in the background, so a burst can pass a little over.
//   a day      the database, sampled: one request in N adds N. N grows with the day: the first 2,000 requests are
//              counted one by one, the next 2,000 in twos, and from 98,000 on in fifties. A day of 100,000 requests
//              is about 9,000 samples, each two rows written, and the first of a day also drops the rows of the
//              day before, against D1's 100,000 rows a day. A sampled count is an estimate: exact up to 2,000,
//              off by about 1.6% at 100,000.
//
// Each Worker instance trusts the day's counts it last saw for half a minute, so most requests read no database row.
// In that half minute it does not see what other instances count, so a day can end that much traffic late.

import type { Database, RequestCounts } from "@poplin/core/src/database/database";
import type { SiteId } from "@poplin/core/src/sites/ids";

import type { Counters, DayWindow, MinuteWindow, Taken } from "@poplin/app/src/limits/limits";

/** The `simple.limit` of the binding in wrangler.jsonc. The two must be equal, or every per-minute setting is off by their ratio. */
const BINDING_LIMIT = 1_000_000;

/** The `simple.period` of the binding. It does not say when its minute ends, so a refused visitor is told the whole of it. */
const BINDING_SECONDS = 60;

/** How many requests share one sampling step: the first this many are counted one by one, the next in twos, and so on. */
const REQUESTS_PER_STEP = 2000;

/** The coarsest sampling: one request in this many. */
const MOST_REQUESTS_PER_SAMPLE = 50;

/** How long an instance trusts the counts it last saw. */
const FRESH_MS = 30_000;

/** How many sites' counts an instance remembers before it forgets them all and reads again. */
const MOST_SITES_REMEMBERED = 1000;

/** The part of Cloudflare's rate limiting binding the minute counts use. */
interface MinuteLimiter {
  limit(options: { readonly key: string; readonly delta: number }): Promise<{ readonly success: boolean }>;
}

/** What the counters are built from. */
interface Parts {
  /** The rate limiting binding, declared with `BINDING_LIMIT` and `BINDING_SECONDS`. */
  readonly limiter: MinuteLimiter;

  /** The database the day's counts are kept in. */
  readonly database: Pick<Database, "addRequests" | "readRequests">;

  /** Draws a number from 0 up to 1, to pick the requests that are sampled; `Math.random` when absent. */
  readonly random?: () => number;
}

/** One site's count as an instance last saw it. */
interface Seen {
  readonly requests: number;
  readonly at: number;
}

/** How many requests one sample stands for once a day has counted this many: 1 counts every request. */
function requestsPerSample(counted: number): number {
  return Math.min(MOST_REQUESTS_PER_SAMPLE, Math.floor(counted / REQUESTS_PER_STEP) + 1);
}

/** The counters of a deployed install. One instance per Worker instance: what it remembers is its own. */
export class CloudflareCounters implements Counters {
  readonly #limiter: MinuteLimiter;

  readonly #database: Parts["database"];

  readonly #random: () => number;

  #day = "";

  #all = 0;

  readonly #sites = new Map<SiteId, Seen>();

  constructor(parts: Parts) {
    this.#limiter = parts.limiter;
    this.#database = parts.database;
    this.#random = parts.random ?? Math.random;
  }

  async takeMinute(window: MinuteWindow): Promise<Taken> {
    const delta = Math.max(1, Math.ceil(BINDING_LIMIT / window.limit));
    const { success } = await this.#limiter.limit({ key: `${window.scope}:${window.key}`, delta });
    if (!success) return { ok: false, retryAfterSeconds: BINDING_SECONDS };

    return { ok: true };
  }

  async readDay(window: DayWindow, now: number): Promise<RequestCounts> {
    const seen = window.day === this.#day ? this.#sites.get(window.site) : undefined;
    if (seen !== undefined && now - seen.at < FRESH_MS) return { site: seen.requests, all: this.#all };

    const counts = await this.#database.readRequests(window.day, window.site);
    this.#remember(window, counts, now);

    return counts;
  }

  async countDay(window: DayWindow, now: number): Promise<void> {
    if (window.day !== this.#day) this.#startDay(window.day);

    const requests = requestsPerSample(this.#all);
    if (this.#random() * requests >= 1) return;

    // Counted here before the database answers, so requests that arrive together sample ever more coarsely instead of each writing its own rows.
    this.#all += requests;
    const counts = await this.#database.addRequests({ day: window.day, site: window.site, requests });
    this.#remember(window, counts, now);
  }

  #remember(window: DayWindow, counts: RequestCounts, now: number): void {
    if (window.day !== this.#day || this.#sites.size >= MOST_SITES_REMEMBERED) this.#startDay(window.day);

    this.#all = counts.all;
    this.#sites.set(window.site, { requests: counts.site, at: now });
  }

  #startDay(day: string): void {
    this.#day = day;
    this.#all = 0;
    this.#sites.clear();
  }
}
