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
//              is about 9,000 samples, each two rows written, and every write also drops the rows older than
//              a year, against D1's 100,000 rows a day. A sampled count is an estimate: exact up to 2,000,
//              off by about 1.6% at 100,000.
//              A sampled request that opened a page adds the same N to its site's views, in the same row and the same write.
//              So a site's views are exact while the install's day is under 2,000 requests, and move in steps of up to 50 after.
//
// An instance counts a day as two numbers: `own`, the requests it took itself, which only ever grows, and `others`, what the database
// showed beyond the instance's own writes, which a later answer of the database can only raise.
// Within one instance the count never falls below the requests that instance itself took that day, so no order in which the database's
// answers come back lets this instance pass more than a limit by its own traffic. Across instances the count is approximate by what the
// other instances did since the database was last read, up to half a minute ago, on either side by at most that.
//
// `others` is an answer less every request this instance had sent to be written when the answer came. An answer made before one of
// those was stored reads low by it, until the next answer. A request whose answer or whose write failed stays in `own` until midnight.
// Each Worker instance trusts what it last read for half a minute, so most requests read no database row.

import type { Database, RequestCounts, RowsUsed } from "@poplin/core/src/database/database";
import type { SiteId } from "@poplin/core/src/sites/ids";

import type { CountedDay, Counters, DayRoom, DayWindow, MinuteWindow, Taken } from "@poplin/app/src/limits/limits";

import type { D1Driver } from "../database/d1";

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

/** How many sites' counts an instance remembers before it forgets the ones it took no request of and was not asked about for half a minute. A site it took a request of is held all day. */
const MOST_SITES_REMEMBERED = 1000;

/** No rows of the database: what a write carries for an instance that counts none. */
const NO_ROWS: RowsUsed = { read: 0, written: 0 };

/** How many days an instance holds counts of: the day, and the one before it while its last writes come back. */
const DAYS_HELD = 2;

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

  /** The rows D1 used for this instance, day by day, which a day's write takes along and a failed write puts back; none are carried when absent. */
  readonly rows?: Pick<D1Driver, "takeRows" | "returnRows">;
}

/** One count as an instance holds it, of a site or of all sites on one day. */
interface Tally {
  /** The requests this instance took. It only grows. */
  own: number;

  /** How many of them it has sent to the database to be written. A write that failed is taken back out. */
  sent: number;

  /** What the database showed beyond this instance's own: the most any of its answers left once `sent` was taken off. */
  others: number;
}

/** A site's count, with when the database last answered for it, `undefined` before the first answer, and when a request last asked about it. */
interface SiteTally extends Tally {
  at: number | undefined;
  asked: number;
}

/** One UTC day as an instance counts it. */
interface Day {
  readonly all: Tally;
  readonly sites: Map<SiteId, SiteTally>;
}

/** How many requests one sample stands for once a day has counted this many: 1 counts every request. */
function requestsPerSample(counted: number): number {
  return Math.min(MOST_REQUESTS_PER_SAMPLE, Math.floor(counted / REQUESTS_PER_STEP) + 1);
}

/** Raise what a tally says of the other instances to what an answer of the database shows, never lower it. */
function raise(tally: Tally, counted: number): void {
  tally.others = Math.max(tally.others, counted - tally.sent);
}

/** The counters of a deployed install. One instance per Worker instance: what it remembers is its own. */
export class CloudflareCounters implements Counters {
  readonly #limiter: MinuteLimiter;

  readonly #database: Parts["database"];

  readonly #random: () => number;

  readonly #rows: Parts["rows"];

  readonly #days = new Map<string, Day>();

  constructor(parts: Parts) {
    this.#limiter = parts.limiter;
    this.#database = parts.database;
    this.#random = parts.random ?? Math.random;
    this.#rows = parts.rows;
  }

  async takeMinute(window: MinuteWindow): Promise<Taken> {
    const delta = Math.max(1, Math.ceil(BINDING_LIMIT / window.limit));
    const { success } = await this.#limiter.limit({ key: `${window.scope}:${window.key}`, delta });
    if (!success) return { ok: false, retryAfterSeconds: BINDING_SECONDS };

    return { ok: true };
  }

  /**
   * Whether the day's counts of a site are ones the instance still trusts: the database answered for them within the half minute, so `readDay` asks it nothing.
   * Nothing is remembered of a site the instance holds no count of.
   */
  isDayFresh(window: DayWindow, now: number): boolean {
    const seen = this.#days.get(window.day)?.sites.get(window.site)?.at;

    return seen !== undefined && now - seen < FRESH_MS;
  }

  /** Take in the day's counts of a site that a read made beside another brought, as `readDay` takes in its own. */
  learnDay(window: DayWindow, counts: RequestCounts, now: number): void {
    this.#day(window.day);
    this.#learn(window, counts, now);
  }

  async readDay(window: DayWindow, now: number): Promise<RequestCounts> {
    this.#site(this.#day(window.day), window.site, now);
    if (!this.isDayFresh(window, now)) this.#learn(window, await this.#database.readRequests(window.day, window.site), now);

    const day = this.#day(window.day);

    return this.#counted(day, this.#site(day, window.site, now));
  }

  sampleDay(window: DayWindow, room: DayRoom, now: number): number | "day" | "site-share" {
    const day = this.#day(window.day);
    const site = this.#site(day, window.site, now);
    const counted = this.#counted(day, site);
    if (counted.all >= room.all) return "day";

    if (counted.site >= room.site) return "site-share";

    const requests = requestsPerSample(counted.all);
    if (this.#random() * requests >= 1) return 0;

    // Counted here before the request is answered and written, so requests that arrive together are checked against it, and sample ever more coarsely instead of each writing its own rows.
    day.all.own += requests;
    site.own += requests;

    return requests;
  }

  async countDay(counted: CountedDay, now: number): Promise<void> {
    const { day, site, requests } = counted;
    const tallies = this.#held(day, site);
    for (const tally of tallies) tally.sent += requests;

    // The write takes along every row D1 used for this instance on its day since the last write, whole and unscaled. What an instance holds when it or the day ends is never written, so a day's rows can read low.
    const rows: RowsUsed = this.#rows?.takeRows(day) ?? NO_ROWS;

    try {
      this.#learn(counted, await this.#database.addRequests({ day, site, requests, views: counted.page ? requests : 0, rows }), now);
    } catch (error) {
      // Not written, so no answer of the database holds it: taken off again, an answer is not read low by it.
      for (const tally of tallies) tally.sent -= requests;
      this.#rows?.returnRows(day, rows);

      throw error;
    }
  }

  #counted(day: Day, site: Tally): RequestCounts {
    return { site: site.own + site.others, all: day.all.own + day.all.others };
  }

  /** The day's counts, begun when the day is new. Of more days than an instance holds, the earliest goes whole. */
  #day(name: string): Day {
    const held = this.#days.get(name);
    if (held !== undefined) return held;

    const day: Day = { all: { own: 0, sent: 0, others: 0 }, sites: new Map() };
    this.#days.set(name, day);
    if (this.#days.size > DAYS_HELD) this.#days.delete([...this.#days.keys()].sort()[0] ?? name);

    return day;
  }

  /**
   * A site's count on a day, begun when the site is new there.
   *
   * A full map forgets only sites this instance took no request of, so `own` is never lost, and of those only the ones no request asked about in the last half minute, so none goes between a request's read and its check.
   */
  #site(day: Day, id: SiteId, now: number): SiteTally {
    const held = day.sites.get(id);
    if (held !== undefined) {
      held.asked = Math.max(held.asked, now);

      return held;
    }

    if (day.sites.size >= MOST_SITES_REMEMBERED) {
      for (const [other, tally] of day.sites) {
        if (tally.own === 0 && now - tally.asked >= FRESH_MS) day.sites.delete(other);
      }
    }

    const site: SiteTally = { own: 0, sent: 0, others: 0, at: undefined, asked: now };
    day.sites.set(id, site);

    return site;
  }

  /** The tallies a write of one request touches, on a day the instance still holds; none for a day it let go. */
  #held(name: string, id: SiteId): Tally[] {
    const day = this.#days.get(name);
    if (day === undefined) return [];

    const site = day.sites.get(id);

    return site === undefined ? [day.all] : [day.all, site];
  }

  /** Take in an answer of the database for one day and site. An answer for a day the instance let go changes nothing. */
  #learn(window: DayWindow, counts: RequestCounts, now: number): void {
    const day = this.#days.get(window.day);
    if (day === undefined) return;

    const site = this.#site(day, window.site, now);
    raise(day.all, counts.all);
    raise(site, counts.site);
    site.at = now;
  }
}
